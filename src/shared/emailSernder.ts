import nodemailer from "nodemailer";
import config from "../app/config";

const emailSender = async (subject: string, email: string, html: string) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
      user: config.emailSender.SMTP_EMAIL,
      pass: config.emailSender.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const info = await transporter.sendMail({
    from: '"frankieuka" <support@www.thelavishly.com>',
    to: email,
    subject: `${subject}`,
    html,
  });

  console.log("Message sent: %s", info.messageId);
};

export default emailSender;
