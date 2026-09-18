import { UserRole } from "@prisma/client";



export interface IAdmin {
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
}

