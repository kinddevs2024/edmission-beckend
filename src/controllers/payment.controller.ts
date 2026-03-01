import express, { Request, Response, NextFunction } from 'express';
import * as paymentService from '../services/payment.service';

export async function createCheckoutSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const { planId, successUrl, cancelUrl } = req.body;
    if (!planId || !successUrl || !cancelUrl) {
      res.status(400).json({ message: 'planId, successUrl, cancelUrl required' });
      return;
    }
    const result = await paymentService.createCheckoutSession(
      req.user.id,
      planId,
      successUrl,
      cancelUrl
    );
    if (result.error) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.json({ url: result.url });
  } catch (e) {
    next(e);
  }
}

export async function webhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const result = await paymentService.handleWebhook(rawBody, signature ?? '');
    if (!result.received) {
      res.status(400).send('Webhook error');
      return;
    }
    res.json({ received: true });
  } catch (e) {
    next(e);
  }
}
