import crypto from 'crypto';

// Generate a random CSRF token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware to generate and validate CSRF tokens
export function csrfProtection(req, res, next) {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Get token from header
  const token = req.headers['x-csrf-token'];

  // Get token from session cookie
  const sessionToken = req.cookies.csrf_token;

  if (!token || !sessionToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  // Compare tokens using timing-safe comparison
  if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(sessionToken))) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }

  next();
}

// Middleware to set CSRF token cookie
export function setCsrfToken(req, res, next) {
  if (!req.cookies.csrf_token) {
    const token = generateToken();
    res.cookie('csrf_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
  }
  next();
}
