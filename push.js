// Push-Benachrichtigungen auf diesem Gerät an- und abmelden.
// Der öffentliche Schlüssel darf öffentlich sein; der geheime liegt nur in Supabase.
export const VAPID_PUBLIC_KEY = 'BHBjIhd_0D8a4NtB9iKQDFyDgKy17m0IBJ8vrG-24pQtC2nzMOUFuK6z2BVr50BE3Erj-DssmzP505TKJjai-pI';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// iPhone/iPad: Push gibt es nur in der installierten App (Home-Bildschirm)
export const iosNeedsInstall = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches;

export const permission = () => (typeof Notification === 'undefined' ? 'default' : Notification.permission);

function keyBytes(b64u) {
  const s = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Fragt nach der Erlaubnis und meldet das Gerät beim Push-Dienst an
export async function subscribe() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    const err = new Error('Benachrichtigungen nicht erlaubt');
    err.code = 'denied';
    throw err;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const { endpoint, keys } = sub.toJSON();
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export async function unsubscribe() {
  const sub = await current();
  if (sub) await sub.unsubscribe();
}

// Kurzer Gerätename für die Übersicht, z. B. "iPhone" oder "Android"
export const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
};
