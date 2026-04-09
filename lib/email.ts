import { Resend } from 'resend';

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ id: string }> {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM must be set');

  const { data, error } = await getResend().emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.body,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  return { id: data!.id };
}
