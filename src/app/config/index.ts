import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  env: process.env.NODE_ENV,
  stripe_key: process.env.STRIPE_SECRET_KEY,
  port: process.env.PORT,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET,
  jwt: {
    jwt_access_secret: process.env.JWT_ACCESS_SECRET,
    jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN,
    jwt_refresh_secret: process.env.JWT_REFRESH_SECRET,
    refresh_token_expires_in: process.env.REFRESH_TOKEN_EXPIRES_IN,
    reset_pass_secret: process.env.RESET_PASS_TOKEN,
    reset_pass_token_expires_in: process.env.RESET_PASS_TOKEN_EXPIRES_IN,
  },
  reset_pass_link: process.env.RESET_PASS_LINK,
  emailSender: {
    SMTP_EMAIL: process.env.SMTP_EMAIL,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
  },
  super_admins: [
    {
      email: process.env.SUPER_ADMIN_1_EMAIL,
      password: process.env.SUPER_ADMIN_1_PASSWORD,
    },
    {
      email: process.env.SUPER_ADMIN_2_EMAIL,
      password: process.env.SUPER_ADMIN_2_PASSWORD,
    },
    {
      email: process.env.SUPER_ADMIN_3_EMAIL,
      password: process.env.SUPER_ADMIN_3_PASSWORD,
    },
  ],
};
