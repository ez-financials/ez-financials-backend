import AWS from 'aws-sdk';

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:"us-east-1",
});

const ses = new AWS.SES({ apiVersion: '2010-12-01' });

export async function sendEmail({ to, subject, text, html }) {
  const params = {
    Source: "banking@ezfinancials.info",
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: html
        ? { Html: { Data: html } }
        : { Text: { Data: text } },
    },
  };
  return ses.sendEmail(params).promise();
} 