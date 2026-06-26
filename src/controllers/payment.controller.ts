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
      res.status(result.statusCode ?? 400).json({ message: result.error });
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
      res.status(result.statusCode ?? 400).json({ message: result.error ?? 'Webhook error' });
      return;
    }
    res.json({ received: true });
  } catch (e) {
    next(e);
  }
}

export async function secureAcceptanceCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await paymentService.getSecureAcceptanceCheckoutHtml(req.params.referenceNumber);
    if (result.error || !result.html) {
      res.status(result.statusCode ?? 404).json({ message: result.error ?? 'Payment session not found' });
      return;
    }
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        `form-action 'self' https://testsecureacceptance.cybersource.com https://secureacceptance.cybersource.com https://secureacceptance.in.cybersource.com`,
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join('; ')
    );
    res.type('html').send(result.html);
  } catch (e) {
    next(e);
  }
}

export async function secureAcceptanceResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await paymentService.handleSecureAcceptanceResponse(req.body as Record<string, unknown>);
    if (!result.received) {
      res.status(result.statusCode ?? 400).json({ message: result.error ?? 'Payment response error' });
      return;
    }
    res.redirect(303, result.redirectUrl ?? '/payment/cancel');
  } catch (e) {
    next(e);
  }
}
