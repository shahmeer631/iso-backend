import { UserRole, UserStatus } from "@prisma/client";


export interface IUser {
  id?: string;
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type IUserFilterRequest = {
  fullName?: string | undefined;
  email?: string | undefined;
  // contactNumber?: string | undefined;
  searchTerm?: string | undefined;
};

export interface IUserCreateInput {
  email: string;
  role: UserRole;
  fullName?: string;
  password?: string;
 
}


export interface UpdateUserPayload {
  email?: string;
  fullName?: string;
  password?: string;
  profileImage?: string | null;
}
