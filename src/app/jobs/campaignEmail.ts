import cron from "node-cron";
import nodemailer from "nodemailer";

// ======================================
// SMTP CONFIG
// ======================================

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
  secure: true,
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// ======================================
// EMAIL TEMPLATES
// ======================================

const welcomeEmailTemplate = (name: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin:auto; padding:20px; color:#111;">
  <h1 style="color:#111;">Welcome to ISOBrain 🚀</h1>

  <p>Hi ${name},</p>

  <p>
    Welcome to ISOBrain — your AI-powered ISO learning and compliance platform.
  </p>

  <p>
    You now have access to powerful tools designed to help professionals master ISO standards faster and smarter.
  </p>

  <a 
    href="https://isobrain.ai"
    style="
      display:inline-block;
      margin-top:20px;
      padding:12px 24px;
      background:#111;
      color:#fff;
      text-decoration:none;
      border-radius:6px;
    "
  >
    Explore ISOBrain
  </a>

  <p style="margin-top:40px;">
    Best regards,<br/>
    The ISOBrain Team
  </p>
</div>
`;

const libraryEmailTemplate = (name: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin:auto; padding:20px; color:#111;">
  <h1>Explore the ISO Library 📚</h1>

  <p>Hi ${name},</p>

  <p>
    Did you know ISOBrain gives you access to a growing library of ISO standards, compliance tools, and implementation resources?
  </p>

  <p>
    Quickly search standards, understand clauses, and learn practical implementation strategies.
  </p>

  <a 
    href="https://isobrain.ai/library/iso-standards"
    style="
      display:inline-block;
      margin-top:20px;
      padding:12px 24px;
      background:#111;
      color:#fff;
      text-decoration:none;
      border-radius:6px;
    "
  >
    Explore Library
  </a>

  <p style="margin-top:40px;">
    Best regards,<br/>
    The ISOBrain Team
  </p>
</div>
`;

const masteryLabTemplate = (name: string) => `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin:auto; padding:20px; color:#111;">
  <h1>Test your knowledge: ISO standards for your job function</h1>

  <p>Hi ${name},</p>

  <p>
    Do you know the ISO standards relevant to your job function as well as you should?
  </p>

  <p>
    Top professionals are using the <strong>AI Mastery Lab</strong> to benchmark their expertise.
    Our AI-driven evaluation adapts directly to your specific industry and management level.
  </p>

  <p>
    In just <strong>10 minutes</strong>, you'll uncover hidden knowledge gaps and receive personalized direction to strengthen your skillset.
  </p>

  <p>
    Don’t guess your competency — measure it.
  </p>

  <a 
    href="https://isobrain.ai/mastery-lab"
    style="
      display:inline-block;
      margin-top:20px;
      padding:12px 24px;
      background:#2563eb;
      color:#fff;
      text-decoration:none;
      border-radius:6px;
    "
  >
    Start your Free Assessment
  </a>

  <p style="margin-top:40px;">
    Best regards,<br/>
    The ISOBrain Team
  </p>
</div>
`;

// ======================================
// SEND EMAIL FUNCTION
// ======================================

const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) => {
  await transporter.sendMail({
    from: `"ISOBrain" <hello@isobrain.ai>`,
    to,
    subject,
    html,
  });
};

// ======================================
// MAIN EMAIL SEQUENCE FUNCTION
// ======================================

export const startEmailSequence = async ({
  email,
  name,
}: {
  email: string;
  name: string;
}) => {
  // ======================================
  // DAY 1 - WELCOME EMAIL
  // ======================================

  setTimeout(async () => {
    await sendEmail({
      to: email,
      subject: "Welcome to ISOBrain 🚀",
      html: welcomeEmailTemplate(name),
    });

    console.log("Welcome email sent");
  }, 1000);

  // ======================================
  // DAY 2 - LIBRARY EMAIL
  // ======================================

  setTimeout(
    async () => {
      await sendEmail({
        to: email,
        subject: "Explore the ISO Library 📚",
        html: libraryEmailTemplate(name),
      });

      console.log("Library email sent");
    },
    1000 * 60 * 60 * 24,
  );

  // ======================================
  // DAY 3 - MASTERY LAB EMAIL
  // ======================================

  setTimeout(
    async () => {
      await sendEmail({
        to: email,
        subject: "Test your ISO knowledge: ISO standards for your job function",
        html: masteryLabTemplate(name),
      });

      console.log("Mastery lab email sent");
    },
    1000 * 60 * 60 * 24 * 2,
  );
};
