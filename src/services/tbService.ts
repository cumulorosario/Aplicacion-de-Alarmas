import { Alarm, AlarmStatus, AuthResponse, Device, TelemetryData } from '../types';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

class ThingsBoardService {
  private baseUrl: string = '';
  private token: string | null = null;
  private tenantId: string | null = null;
  private customerId: string | null = null;
  private authority: string | null = null;
  private socket: WebSocket | null = null;

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  setToken(token: string) {
    this.token = token;
  }

  private async fetchApi(path: string, options: RequestInit = {}) {
    if (!this.baseUrl) throw new Error('Base URL not set');

    let finalUrl = `${this.baseUrl}${path}`;
    
    const isNetlify = window.location.hostname.includes('netlify.app');
    const isLocalOrDev = window.location.hostname.includes('localhost') || window.location.hostname.includes('run.app');
    const isNative = Capacitor.isNativePlatform() || (window as any).Capacitor?.isNative;
    const platform = Capacitor.getPlatform();

    // Logic to handle Proxy
    if (isNative) {
      // On native apps, we don't use the proxy as we can jump CORS/HTTP restrictions using Native HTTP
      finalUrl = `${this.baseUrl}${path}`;
    } else if (isNetlify) {
      finalUrl = path; 
    } else if (this.baseUrl.startsWith('http')) {
      // For web based apps, always use proxy if calling an external absolute URL
      // to avoid Mixed Content (if app is HTTPS and TB is HTTP) and CORS issues.
      // Use a relative path to ensure same-origin fetch and avoid AIS iframe origin issues.
      finalUrl = `/api/proxy?url=${encodeURIComponent(this.baseUrl + path)}`;
    }

    console.log(`[TB Service] Fetching: ${options.method || 'GET'} ${finalUrl}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'X-Authorization': `Bearer ${this.token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    if (isNative) {
      try {
        const response = await CapacitorHttp.request({
          url: finalUrl,
          method: options.method || 'GET',
          data: options.body ? JSON.parse(options.body as string) : undefined,
          headers
        });

        if (response.status >= 200 && response.status < 300) {
          return response.data;
        }

        let errorMessage = `Error de Servidor (${response.status})`;
        if (typeof response.data === 'string' && response.data.includes('<!doctype html>')) {
          errorMessage = "No se pudo conectar con el servidor ThingsBoard (Posible error de URL o Red).";
        } else if (response.data?.message) {
          errorMessage = response.data.message;
        }
        
        throw new Error(errorMessage);
      } catch (e: any) {
        if (e.message) throw e;
        throw new Error(`Error de conexión nativa (${platform})`);
      }
    }

    try {
      const response = await fetch(finalUrl, { ...options, headers });
      
      // If we got a 502 from our own proxy, it means the target TB server is unreachable
      if (response.status === 502) {
        throw new Error("El servidor ThingsBoard no responde (Error 502 via Proxy). Verifica que la URL sea correcta y accesible.");
      }

      const contentType = response.headers.get('content-type');
      
      if (!response.ok) {
        let errorMessage = `Error de Servidor (${response.status})`;
        try {
          if (contentType?.includes('application/json')) {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } else {
            const text = await response.text();
            errorMessage = text.slice(0, 150) || `Error ${response.status}`;
            // If it's HTML but 401/403, it's likely a login redirect
            if (text.includes('<!doctype html>') && (response.status === 401 || response.status === 403)) {
              errorMessage = "Sesión expirada o no autorizada. Por favor, reingresa.";
            }
          }
        } catch (e) {
          errorMessage = `Error ${response.status}`;
        }
        console.error(`[TB Service Error] ${path}: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      if (contentType?.includes('application/json')) {
        return response.json();
      } else {
        const text = await response.text();
        // Verificamos si realmente no es un JSON por accidente (a veces content-type falta)
        try {
          return JSON.parse(text);
        } catch (e) {
          const preview = text.slice(0, 100).replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const envInfo = `Plataforma: ${platform}, URL: ${this.baseUrl}`;
          console.error(`[TB Service] Respuesta no JSON de ${path} (${platform}): ${preview}`);
          throw new Error(`Respuesta inesperada del servidor (no es JSON). ${envInfo}. Verifica que la URL no esté bloqueada.`);
        }
      }
    } catch (e: any) {
      console.error(`[TB Service] Error en fetchApi (${path}):`, e);
      if (e.message === 'Failed to fetch' || e.name === 'TypeError') {
        throw new Error("Error de Red: No se pudo contactar con el servidor. Verifica tu conexión a internet o si el servidor está bloqueando la petición.");
      }
      throw e;
    }
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const data = await this.fetchApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.token = data.token;
    
    // Fetch current user info to get context
    try {
      const user = await this.fetchApi('/api/auth/user');
      this.authority = user.authority;
      if (user && user.tenantId) {
        this.tenantId = user.tenantId.id;
      }
      if (user && user.customerId && user.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
        this.customerId = user.customerId.id;
      }
      console.log(`Auth context: ${this.authority}, Tenant: ${this.tenantId}, Customer: ${this.customerId}`);
    } catch (e) {
      console.warn("No se pudo obtener el contexto del usuario automáticamente.");
    }

    return data;
  }

  async getDevices(pageSize = 100): Promise<Device[]> {
    let endpoint = `/api/tenant/devices?pageSize=${pageSize}&page=0`;
    
    if (this.authority === 'CUSTOMER_USER' && this.customerId) {
      endpoint = `/api/customer/${this.customerId}/devices?pageSize=${pageSize}&page=0`;
    }

    const data = await this.fetchApi(endpoint);
    const devices: Device[] = data.data || [];
    
    if (devices.length === 0) return [];

    // Fetch connectivity status for each device
    const updatedDevices = await Promise.all(devices.map(async (device) => {
      try {
        const attributes = await this.fetchApi(`/api/plugins/telemetry/DEVICE/${device.id.id}/values/attributes`);
        
        const activeAttr = attributes.find((a: any) => a.key === 'active');
        const lastConnectAttr = attributes.find((a: any) => a.key === 'lastConnectTime');
        const lastDisconnectAttr = attributes.find((a: any) => a.key === 'lastDisconnectTime');
        
        const isActive = activeAttr ? (activeAttr.value === true || activeAttr.value === 'true') : false;
        const lastConnect = lastConnectAttr ? parseInt(lastConnectAttr.value) : 0;
        const lastDisconnect = lastDisconnectAttr ? parseInt(lastDisconnectAttr.value) : 0;
        
        // Un dispositivo está online si está 'active' y (su última conexión es posterior a su última desconexión o no hay desconexión)
        const online = isActive && (lastConnect > lastDisconnect || lastDisconnect === 0);
        
        return { ...device, online };
      } catch (e) {
        return { ...device, online: false };
      }
    }));

    return updatedDevices;
  }

  async getAlarms(pageSize = 50, status?: string): Promise<Alarm[]> {
    const query = status ? `&status=${status}` : '';
    let allAlarms: Alarm[] = [];

    // Prioridad 1: Búsqueda General (si el endpoint existe y está permitido)
    try {
      const generalAlarms = await this.fetchApi(`/api/alarms?pageSize=${pageSize}&page=0${query}`);
      if (generalAlarms && generalAlarms.data) {
        allAlarms = [...generalAlarms.data];
        console.log(`[TB Service] Alarmas Generales encontradas: ${allAlarms.length}`);
      }
    } catch (e) {
      console.log("[TB Service] /api/alarms no disponible o denegado, probando entidades específicas...");
    }

    // Prioridad 2: Buscar por Tenant (Admin)
    if (this.tenantId) {
      try {
        const tenantAlarms = await this.fetchApi(`/api/alarm/TENANT/${this.tenantId}?pageSize=${pageSize}&page=0${query}`);
        if (tenantAlarms && tenantAlarms.data) {
          tenantAlarms.data.forEach((a: Alarm) => {
            if (!allAlarms.find(prev => prev.id.id === a.id.id)) {
              allAlarms.push(a);
            }
          });
          console.log(`[TB Service] Total alarmas tras busqueda Tenant: ${allAlarms.length}`);
        }
      } catch (e) {
        console.warn("Error fetching tenant alarms", e);
      }
    }

    // Prioridad 3: Buscar por Customer
    if (this.customerId) {
      try {
        const customerAlarms = await this.fetchApi(`/api/alarm/CUSTOMER/${this.customerId}?pageSize=${pageSize}&page=0${query}`);
        if (customerAlarms && customerAlarms.data) {
          customerAlarms.data.forEach((a: Alarm) => {
            if (!allAlarms.find(prev => prev.id.id === a.id.id)) {
              allAlarms.push(a);
            }
          });
          console.log(`[TB Service] Total alarmas tras busqueda Customer: ${allAlarms.length}`);
        }
      } catch (e) {
        console.warn("Error fetching customer alarms", e);
      }
    }

    // Prioridad 4: Búsqueda exhaustiva en los dispositivos si allAlarms sigue vacio o es muy corto
    if (allAlarms.length < 5) {
      console.log("[TB Service] Pocas alarmas encontradas, iniciando búsqueda por dispositivo fallback...");
      try {
        const devices = await this.getDevices(30);
        const deviceAlarmsPromises = devices.map(async (d) => {
          try {
            const res = await this.fetchApi(`/api/alarm/DEVICE/${d.id.id}?pageSize=10&page=0${query}`);
            return res.data || [];
          } catch {
            return [];
          }
        });
        
        const results = await Promise.all(deviceAlarmsPromises);
        results.forEach(alarms => {
          if (alarms && Array.isArray(alarms)) {
            alarms.forEach((alarm: Alarm) => {
              if (!allAlarms.find(a => a.id.id === alarm.id.id)) {
                allAlarms.push(alarm);
              }
            });
          }
        });
        console.log(`[TB Service] Total alarmas tras búsqueda por dispositivos: ${allAlarms.length}`);
      } catch (e) {
        console.warn("Error en búsqueda por dispositivo fallback", e);
      }
    }

    return allAlarms.sort((a, b) => b.createdTime - a.createdTime);
  }

  async acknowledgeAlarm(alarmId: string) {
    return this.fetchApi(`/api/alarm/${alarmId}/ack`, { method: 'POST' });
  }

  async clearAlarm(alarmId: string) {
    return this.fetchApi(`/api/alarm/${alarmId}/clear`, { method: 'POST' });
  }

  // WebSocket support for real-time telemetry and alarms
  connectWebSocket(onMessage: (data: any) => void) {
    if (!this.token || !this.baseUrl) return;

    const wsUrl = this.baseUrl.replace('http', 'ws') + '/api/ws/plugins/telemetry?token=' + this.token;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('WebSocket Connected');
      // Subscribe to all entity updates if needed, but usually we subscribe to specific device IDs
    };

    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    this.socket.onclose = () => console.log('WebSocket Disconnected');
    this.socket.onerror = (error) => console.error('WebSocket Error', error);
  }

  subscribeToTelemetry(entityId: string, cmdId: number) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const msg = {
        tsSubCmds: [
          {
            entityType: 'DEVICE',
            entityId,
            scope: 'LATEST_TELEMETRY',
            cmdId
          }
        ]
      };
      this.socket.send(JSON.stringify(msg));
    }
  }

  subscribeToAlarms(cmdId: number) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && (this.tenantId || this.customerId)) {
      const msg = {
        alarmSubCmds: [
          {
            entityType: this.authority === 'CUSTOMER_USER' ? 'CUSTOMER' : 'TENANT',
            entityId: this.authority === 'CUSTOMER_USER' ? this.customerId : this.tenantId,
            cmdId
          }
        ]
      };
      this.socket.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.socket?.close();
  }
}

export const tbService = new ThingsBoardService();
