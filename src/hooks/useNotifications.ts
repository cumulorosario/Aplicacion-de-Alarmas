import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App as CapacitorApp } from '@capacitor/app';

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    // Escuchar cambios de estado de la app
    const handler = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      setIsActive(isActive);
      console.log(`[Notifications] App state changed. Active: ${isActive}`);
    });

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
        const settings = options?.settings || { vibrate: true, sound: true, wake: true };
        
        // Si la app está activa, no vibramos ni hacemos ruido con la notificación push
        const useVibration = !isActive && settings.vibrate;
        const useSound = !isActive && settings.sound;
        const importance = isActive ? 2 : (settings.wake ? 5 : 4); // 2 = LOW, no sound/vibration

        // Solo crear el canal si es necesario para evitar ruidos de sistema
        const channels = await LocalNotifications.listChannels();
        const existing = channels.channels.find(c => c.id === 'critical_alerts');
        
        if (!existing || existing.importance !== importance) {
          await LocalNotifications.createChannel({
            id: 'critical_alerts',
            name: 'Alertas Críticas',
            importance: importance,
            description: 'Canal para alarmas industriales urgentes',
            sound: useSound ? 'beep.wav' : undefined,
            visibility: 1,
            vibration: useVibration,
            lights: true,
            lightColor: '#ff0000'
          });
        }

        await LocalNotifications.schedule({
          notifications: [
            {
              title,
              body: options?.body || '',
              id: Math.floor(Math.random() * 10000),
              extra: options?.tag ? { tag: options.tag } : undefined,
              channelId: 'critical_alerts',
              smallIcon: 'ic_stat_alarm',
              largeIcon: 'ic_launcher',
              schedule: { at: new Date(Date.now() + 100) },
              sound: useSound ? 'beep.wav' : undefined,
              ongoing: !isActive && importance === 5,
              autoCancel: true,
              group: 'vigia_alarms'
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
