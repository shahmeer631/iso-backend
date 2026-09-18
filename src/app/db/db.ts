import { UserRole } from "@prisma/client";
import prisma from "../../shared/prisma";
import * as bcrypt from "bcrypt";
import config from "../config";

export const initiateSuperAdmin = async () => {
  const superAdmins = config.super_admins || [];

  for (const admin of superAdmins) {
    if (!admin.email || !admin.password) continue;

    const normalizedEmail = admin.email.toLowerCase();

    const isExistUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (isExistUser) continue;

    const hashedPassword: string = await bcrypt.hash(
      admin.password,
      Number(config.bcrypt_salt_rounds)
    );

    await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        status: "ACTIVE" as any,
        isDeleted: false,
        stripeCustomerId: `super_admin_${admin.email}`, // Bypass unique constraint on null for MongoDB
      },
    });
  }
};
