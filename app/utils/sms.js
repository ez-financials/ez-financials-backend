import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE;

const client = twilio(accountSid, authToken);

export async function sendSMS({ to, body }) {
  return client.messages.create({
    body,
    from: twilioPhone,
    to,
  });
} 