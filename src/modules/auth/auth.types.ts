export type AdminAccess = {
  profile: {
    id: string;
    authUserId: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };
  roles: string[];
  permissions: string[];
};

export type AuthenticatedUser = {
  id: string;
  email?: string;
  sessionId?: string;
  adminAccess?: AdminAccess;
};
