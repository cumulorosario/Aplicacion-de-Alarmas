import { useState, useEffect } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('Service Worker registrado con éxito:', reg);
          setRegistration(reg);
        })
        .catch(err => console.error('Error al registrar Service Worker:', err));
    }
  }, []);

  const requestPermission = async () => {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    }
    return 'denied' as NotificationPermission;
  };

  const showNotification = (title: string, options?: NotificationOptions) => {
    if (permission === 'granted') {
      // Usar Service Worker si está disponible para mejor soporte en background/bloqueo
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
  };

  return { permission, requestPermission, showNotification };
}
