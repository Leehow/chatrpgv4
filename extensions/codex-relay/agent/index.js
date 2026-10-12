import { AUTH_PROVIDER_ID, createAuthProvider } from "./provider.js";
export default function codexRelay(pi) {
    pi.registerProvider(AUTH_PROVIDER_ID, createAuthProvider());
}
