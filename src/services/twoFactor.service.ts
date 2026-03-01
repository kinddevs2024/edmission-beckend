import { authenticator } from 'otplib';
import { User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

export async function setup2FA(userId: string): Promise<{ secret: string; qrUrl: string }> {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  const secret = authenticator.generateSecret();
  await User.findByIdAndUpdate(userId, { totpSecret: secret, totpEnabled: false });
  const appName = 'Edmission';
  const qrUrl = authenticator.keyuri((user as { email: string }).email, appName, secret);
  return { secret, qrUrl };
}

export async function verifyAndEnable2FA(userId: string, code: string): Promise<boolean> {
  const user = await User.findById(userId).select('totpSecret');
  if (!user || !(user as { totpSecret?: string }).totpSecret) {
    throw new AppError(400, '2FA not set up. Call setup first.', ErrorCodes.VALIDATION);
  }
  const valid = authenticator.verify({ token: code, secret: (user as { totpSecret: string }).totpSecret });
  if (!valid) return false;
  await User.findByIdAndUpdate(userId, { totpEnabled: true });
  return true;
}

export async function disable2FA(userId: string, code: string): Promise<boolean> {
  const user = await User.findById(userId).select('totpSecret totpEnabled');
  if (!user) throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  if (!(user as { totpEnabled?: boolean }).totpEnabled) return true;
  const secret = (user as { totpSecret?: string }).totpSecret;
  if (!secret) return true;
  const valid = authenticator.verify({ token: code, secret });
  if (!valid) return false;
  await User.findByIdAndUpdate(userId, { totpEnabled: false, totpSecret: null });
  return true;
}

export async function verify2FACode(userId: string, code: string): Promise<boolean> {
  const user = await User.findById(userId).select('totpSecret totpEnabled');
  if (!user || !(user as { totpEnabled?: boolean }).totpEnabled) return true;
  const secret = (user as { totpSecret?: string }).totpSecret;
  if (!secret) return false;
  return authenticator.verify({ token: code, secret });
}
