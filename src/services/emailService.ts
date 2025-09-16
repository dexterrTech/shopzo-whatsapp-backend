import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { env } from '../config/env';

if (env.SENDGRID_API_KEY) {
  sgMail.setApiKey(env.SENDGRID_API_KEY);
}

export interface AggregatorInviteEmail {
  to: string;
  tempPassword: string;
  verifyUrl: string;
  username: string;
  aggregatorName?: string;
}

function baseTemplate(content: string, title = "Notification") {
  return `
  <div style="max-width:600px;margin:0 auto;padding:20px;
              font-family:Arial,Helvetica,sans-serif;
              font-size:15px;line-height:1.6;color:#333;
              background:#f9f9f9;border-radius:8px">
    <div style="text-align:center;margin-bottom:20px">
      <h2 style="margin:0;color:#0d6efd">${title}</h2>
    </div>
    <div style="background:#fff;padding:20px;border-radius:8px;
                box-shadow:0 2px 6px rgba(0,0,0,0.08)">
      ${content}
    </div>
    <p style="text-align:center;margin-top:20px;font-size:12px;color:#888">
      This is an automated message, please do not reply.<br/>
      © ${new Date().getFullYear()} Shozo.app
    </p>
  </div>
  `;
}

export async function sendAggregatorInviteEmail(params: AggregatorInviteEmail): Promise<void> {
  const from = env.EMAIL_FROM || 'no-reply@yourdomain.com';

  const content = `
    <p>Hi${params.aggregatorName ? ' ' + params.aggregatorName : ''},</p>
    <p>Your aggregator account has been successfully created. 
       Please verify your email and log in using the credentials below:</p>
    <p style="background:#f3f4f6;padding:12px;border-radius:6px">
      <b>Username:</b> ${params.username}<br/>
      <b>Temporary password:</b> ${params.tempPassword}
    </p>
    <p style="text-align:center">
      <a href="${params.verifyUrl}" 
         style="display:inline-block;padding:12px 20px;
                background:#0d6efd;color:#fff;font-weight:bold;
                text-decoration:none;border-radius:6px">
        Verify My Email
      </a>
    </p>
    <p>If the button above doesn’t work, copy this link into your browser:</p>
    <p><a href="${params.verifyUrl}" style="color:#0d6efd">${params.verifyUrl}</a></p>
    <p>If you didn’t request this, you can safely ignore this email.</p>
  `;
  // Prefer SMTP if configured
  if (env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT || 587,
      secure: Boolean(env.SMTP_SECURE),
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    } as any);
    await transporter.sendMail({
      to: params.to,
      from,
      subject: 'Your Aggregator Account – Verify Email',
      html: baseTemplate(content, "Welcome to Our Platform"),
    });
    return;
  }
  if (env.SENDGRID_API_KEY) {
    await sgMail.send({
      to: params.to,
      from,
      subject: 'Your Aggregator Account – Verify Email',
      html: baseTemplate(content, "Welcome to Our Platform"),
    });
    return;
  }
  console.warn('No SMTP or SENDGRID configured; skipping email send.');
}

export async function sendVerificationLink(to: string, verifyUrl: string): Promise<void> {
  const from = env.EMAIL_FROM || 'no-reply@yourdomain.com';

  const content = `
    <p>Hi there,</p>
    <p>Please verify your email address to activate your account.</p>
    <p style="text-align:center">
      <a href="${verifyUrl}" 
         style="display:inline-block;padding:12px 20px;
                background:#0d6efd;color:#fff;font-weight:bold;
                text-decoration:none;border-radius:6px">
        Verify My Email
      </a>
    </p>
    <p>If the button above doesn’t work, copy this link into your browser:</p>
    <p><a href="${verifyUrl}" style="color:#0d6efd">${verifyUrl}</a></p>
  `;
  if (env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT || 587,
      secure: Boolean(env.SMTP_SECURE),
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    } as any);
    await transporter.sendMail({
      to,
      from,
      subject: 'Verify Your Email Address',
      html: baseTemplate(content, "Email Verification"),
    });
    return;
  }
  if (env.SENDGRID_API_KEY) {
    await sgMail.send({
      to,
      from,
      subject: 'Verify Your Email Address',
      html: baseTemplate(content, "Email Verification"),
    });
    return;
  }
  console.warn('No SMTP or SENDGRID configured; skipping email send.');
}
