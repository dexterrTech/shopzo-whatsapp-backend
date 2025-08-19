import { pool } from '../config/database';

export type BillingCategory = 'utility' | 'marketing' | 'authentication' | 'service';

export interface PricePlan {
  id: number;
  currency: string;
  utility_paise: number;
  marketing_paise: number;
  authentication_paise: number;
  service_paise: number;
}

export async function resolveUserPricePlan(userId: number): Promise<PricePlan> {
  const planRes = await pool.query(
    `SELECT pp.*
     FROM user_price_plans upp
     JOIN price_plans pp ON pp.id = upp.price_plan_id
     WHERE upp.user_id = $1
     ORDER BY upp.effective_from DESC
     LIMIT 1`,
    [userId]
  );
  if (planRes.rows[0]) return planRes.rows[0];

  const defRes = await pool.query(`SELECT * FROM price_plans WHERE is_default = TRUE ORDER BY id ASC LIMIT 1`);
  if (!defRes.rows[0]) {
    return {
      id: 0,
      currency: 'INR',
      utility_paise: 0,
      marketing_paise: 0,
      authentication_paise: 0,
      service_paise: 0,
    } as any;
  }
  return defRes.rows[0];
}

export async function priceOverride(planId: number, countryCode: string | undefined, category: BillingCategory): Promise<{ amount: number, currency: string } | null> {
  if (!countryCode) return null;
  const r = await pool.query(
    `SELECT amount_paise, currency FROM price_plan_overrides WHERE price_plan_id = $1 AND country_code = $2 AND category = $3`,
    [planId, countryCode, category]
  );
  if (!r.rows[0]) return null;
  return { amount: r.rows[0].amount_paise, currency: r.rows[0].currency };
}

export function basePriceForCategory(plan: PricePlan, category: BillingCategory): number {
  switch (category) {
    case 'utility':
      return plan.utility_paise;
    case 'marketing':
      return plan.marketing_paise;
    case 'authentication':
      return plan.authentication_paise;
    case 'service':
      return plan.service_paise;
    default:
      return 0;
  }
}

export async function upsertBillingLog(params: {
  userId: number;
  conversationId: string;
  category: BillingCategory;
  recipientNumber: string;
  startTime: string | Date;
  endTime: string | Date;
  countryCode?: string;
  countryName?: string;
  billingStatus?: 'pending' | 'paid' | 'failed';
}): Promise<{ id: number } | null> {
  const plan = await resolveUserPricePlan(params.userId);
  const override = await priceOverride(plan.id, params.countryCode, params.category);
  const amountPaise = override ? override.amount : basePriceForCategory(plan, params.category);
  const currency = override ? override.currency : plan.currency;
  const status = params.billingStatus || 'pending';

  const res = await pool.query(
    `INSERT INTO billing_logs (
       conversation_id, user_id, category, recipient_number,
       start_time, end_time, billing_status, amount_paise, amount_currency,
       country_code, country_name, price_plan_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT ON CONSTRAINT uq_billing_logs_conversation_per_user
     DO UPDATE SET
       category = EXCLUDED.category,
       recipient_number = EXCLUDED.recipient_number,
       start_time = LEAST(billing_logs.start_time, EXCLUDED.start_time),
       end_time = GREATEST(billing_logs.end_time, EXCLUDED.end_time),
       billing_status = EXCLUDED.billing_status,
       amount_paise = EXCLUDED.amount_paise,
       amount_currency = EXCLUDED.amount_currency,
       country_code = COALESCE(EXCLUDED.country_code, billing_logs.country_code),
       country_name = COALESCE(EXCLUDED.country_name, billing_logs.country_name),
       price_plan_id = EXCLUDED.price_plan_id,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      params.conversationId,
      params.userId,
      params.category,
      params.recipientNumber,
      new Date(params.startTime),
      new Date(params.endTime),
      status,
      amountPaise,
      currency,
      params.countryCode || null,
      params.countryName || null,
      plan.id || null,
    ]
  );

  return res.rows[0] || null;
}

export async function chargeWalletForBilling(params: {
  userId: number;
  conversationId: string;
  amountPaise: number;
  currency: string;
}): Promise<number | null> {
  // Idempotent: check if this billing log already has a wallet_tx_id
  const existing = await pool.query(
    `SELECT id, wallet_tx_id FROM billing_logs WHERE user_id = $1 AND conversation_id = $2`,
    [params.userId, params.conversationId]
  );
  const logRow = existing.rows[0];
  if (!logRow) return null;
  if (logRow.wallet_tx_id) return logRow.wallet_tx_id;

  await pool.query('BEGIN');
  try {
    // Lock wallet row
    const balRes = await pool.query('SELECT balance_paise FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [params.userId]);
    const current = balRes.rows[0]?.balance_paise ?? 0;
    const nextBal = current - params.amountPaise;
    if (nextBal < 0) {
      await pool.query('ROLLBACK');
      return null; // insufficient balance; caller decides policy
    }
    // Update balance
    await pool.query('UPDATE wallet_accounts SET balance_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [nextBal, params.userId]);
    // Create tx
    const txId = `BL-${params.conversationId}`.slice(0, 60);
    const insTx = await pool.query(
      `INSERT INTO wallet_transactions (user_id, transaction_id, type, status, amount_paise, currency, details, balance_after_paise)
       VALUES ($1,$2,'DEBIT','completed',$3,$4,$5,$6)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING id`,
      [params.userId, txId, params.amountPaise, params.currency, 'Billing charge', nextBal]
    );
    const walletTxId = insTx.rows[0]?.id;
    if (walletTxId) {
      await pool.query('UPDATE billing_logs SET wallet_tx_id = $1, billing_status = $2 WHERE id = $3', [walletTxId, 'paid', logRow.id]);
    }
    await pool.query('COMMIT');
    return walletTxId || null;
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}


