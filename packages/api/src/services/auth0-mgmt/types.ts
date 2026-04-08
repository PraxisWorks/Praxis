export type CreateUserResult = {
  auth0UserId: string;
  created: boolean;
};

export type ChangePasswordTicketResult = {
  ticketUrl: string;
};

export type SendVerificationEmailResult = {
  success: boolean;
};

export type Auth0MgmtAdapter = {
  createUser(email: string): Promise<CreateUserResult>;
  changePasswordTicket(auth0UserId: string, email: string): Promise<ChangePasswordTicketResult>;
  sendVerificationEmail(auth0UserId: string): Promise<SendVerificationEmailResult>;
};
