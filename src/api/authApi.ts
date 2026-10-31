import { api } from './client';
import type { UserDto } from './userApi';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresInMinutes: number;
  user: UserDto;
}

export interface AuthConfigResponse {
  githubOAuthEnabled: boolean;
}

/** A one-click login button on the login page; public, so no email. */
export interface DemoAccountDto {
  id: number;
  username: string;
  name: string;
  avatarColor: string;
}

export const authApi = {
  login: (req: LoginRequest) => api.post<AuthTokenResponse>('/api/auth/token', req),
  getConfig: () => api.get<AuthConfigResponse>('/api/auth/config'),
  getDemoAccounts: () => api.get<DemoAccountDto[]>('/api/auth/demo-accounts'),
};
