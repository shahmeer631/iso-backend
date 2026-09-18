import nodemailer from "nodemailer";
import dotenv from "dotenv";
import config from "../app/config";

dotenv.config();
// Create a transporter using SMTP
const transporter = nodemailer.createTransport({
  host: config.emailSender.SMTP_HOST,
  port: 465,
  secure: true,
  auth: {
    user: config.emailSender.SMTP_EMAIL,
    pass: config.emailSender.SMTP_PASS,
  },
});

export const sendOTPEmail = async (
  email: string,
  otp: string,
): Promise<void> => {
  try {
    const mailOptions = {
      from: config.emailSender.SMTP_EMAIL,
      to: email,
      subject: "Your OTP Code",
      text: `Your OTP code is: ${otp}. It will expire in 5 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #333;">Your One-Time Password</h2>
          <p style="font-size: 16px; color: #555;">Use the following OTP to complete your verification:</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; text-align: center; margin: 20px 0;">
            <h1 style="font-size: 32px; margin: 0; color: #333;">${otp}</h1>
          </div>
          <p style="font-size: 14px; color: #777;">This OTP will expire in 5 minutes.</p>
          <p style="font-size: 14px; color: #777;">If you didn't request this OTP, please ignore this email.</p>
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", email);
  } catch (error) {
    //console.error('Error in sendOTPEmail function:', error);
    throw error;
  }
};

// Verify connection configuration
transporter.verify(function (error, success) {
  if (error) {
    //onsole.error('SMTP connection error:', error);
  } else {
    //onsole.log('SMTP server is ready to take our messages');
  }
});
