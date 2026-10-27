import { Router } from 'express';
import * as c from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, refreshLimiter } from '../middleware/security.js';
import { loginSchema, refreshSchema, changePasswordSchema } from '../validators/auth.validators.js';

const r = Router();

r.post('/login', authLimiter, validate(loginSchema), c.login);
r.post('/refresh', refreshLimiter, validate(refreshSchema), c.refresh);
r.post('/logout', c.logout);
r.get('/me', authenticate, c.me);
r.post('/change-password', authenticate, authLimiter, validate(changePasswordSchema), c.changePassword);
r.get('/sessions', authenticate, c.sessions);
r.post('/sessions/revoke-all', authenticate, c.signOutEverywhere);

export default r;
