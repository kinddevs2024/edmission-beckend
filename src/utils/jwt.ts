import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import type { Role } from '../types/role';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
// TTL in seconds: 15 min and 7 days
const JWT_ACCESS_TTL_SEC = 15 * 60;
const JWT_REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  jti?: string;
}

export function signAccessToken(payload: Omit<TokenPayload, 'jti'>): string {
  return jwt.sign(
    { ...payload, jti: uuidv4() },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_TTL_SEC }
  );
}

export function signRefreshToken(payload: Omit<TokenPayload, 'jti'>): string {
  return jwt.sign(
    { ...payload, jti: uuidv4() },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_TTL_SEC }
  );
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
}
