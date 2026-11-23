/** Firma y verificación del token de sesión (sin dependencias de servidor: usable en proxy). */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "flota_session";
export const SESSION_HOURS = 12;

export type SessionClaims = { sub: string; role: "admin" | "editor" | "viewer"; name: string };

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET no está configurado (mínimo 32 caracteres). Revisa .env.local");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, name: claims.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { sub: payload.sub, role: payload.role as SessionClaims["role"], name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}
