import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const checkPermissions = async () => {
      if (Capacitor.isNativePlatform()) {
        const status = await LocalNotifications.checkPermissions();
        const mapped = status.display === 'granted' ? 'granted' : (status.display === 'denied' ? 'denied' : 'default');
        setPermission(mapped as NotificationPermission);
      } else if ('Notification' in window) {
        setPermission(Notification.permission);
      }
    };

    checkPermissions();

    if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('Service Worker registrado con éxito:', reg);
          setRegistration(reg);
        })
        .catch(err => console.error('Error al registrar Service Worker:', err));
    }
  }, []);

  const requestPermission = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        console.log("[Notifications] Requesting native permissions...");
        const result = await LocalNotifications.requestPermissions();
        console.log("[Notifications] Permission search result:", JSON.stringify(result));
        const mapped = result.display === 'granted' ? 'granted' : (result.display === 'denied' ? 'denied' : 'default');
        setPermission(mapped as NotificationPermission);
        return mapped as NotificationPermission;
      } else if ('Notification' in window) {
        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
      }
    } catch (e: any) {
      console.error("[Notifications] Error requesting permission:", e);
      alert(`Error de permisos: ${e.message}`);
    }
    return 'denied' as NotificationPermission;
  };

  const showNotification = async (title: string, options?: any) => {
    if (permission === 'granted') {
      if (Capacitor.isNativePlatform()) {
        await LocalNotifications.schedule({
          notifications: [
            {
              title,
              body: options?.body || '',
              id: Math.floor(Math.random() * 10000),
              extra: options?.tag ? { tag: options.tag } : undefined,
              sound: 'beep.wav'
            }
          ]
        });
      } else {
        // Usar Service Worker si está disponible
        if (registration) {
          registration.showNotification(title, {
            icon: '/logo.png',
            badge: '/logo.png',
            vibrate: [200, 100, 200],
            ...options
          });
        } else {
          new Notification(title, {
            icon: '/logo.png',
            ...options
          });
        }
      }
    }
  };

  return { permission, requestPermission, showNotification };
}
