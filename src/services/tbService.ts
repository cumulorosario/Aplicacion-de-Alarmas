import { Alarm, AlarmStatus, AuthResponse, Device, TelemetryData } from '../types';

class ThingsBoardService {
  private baseUrl: string = '';
  private token: string | null = null;
  private tenantId: string | null = null;
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

    // Logic to handle Proxy differently based on environment
    if (isNetlify) {
      // Netlify handles proxying via _redirects file
      // We assume /api/* is proxied to http://cumuloingenieria.duckdns.org:9090/api/*
      finalUrl = path; 
    } else if (isLocalOrDev && this.baseUrl.startsWith('http')) {
      // AI Studio / Local development uses our custom Node proxy
      finalUrl = `/api/proxy?url=${encodeURIComponent(this.baseUrl + path)}`;
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'X-Authorization': `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    const response = await fetch(finalUrl, { ...options, headers });
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
        const preview = text.slice(0, 70).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        console.error(`[TB Service] Respuesta no JSON de ${path}: ${preview}`);
        throw new Error(`Respuesta inesperada del servidor (no es JSON). Verifica la URL base.`);
      }
    }
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const data = await this.fetchApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.token = data.token;
    
    // Fetch current user info to get tenantId
    try {
      const user = await this.fetchApi('/api/auth/user');
      if (user && user.tenantId) {
        this.tenantId = user.tenantId.id;
        console.log("Tenant ID identificado:", this.tenantId);
      }
    } catch (e) {
      console.warn("No se pudo obtener el ID del tenant automáticamente.");
    }

    return data;
  }

  async getDevices(pageSize = 100): Promise<Device[]> {
    const data = await this.fetchApi(`/api/tenant/devices?pageSize=${pageSize}&page=0`);
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
    
    // Primero intentamos obtener alarmas del tenant (por si acaso hay alguna propagada)
    let allAlarms: Alarm[] = [];
    if (this.tenantId) {
      try {
        const tenantAlarms = await this.fetchApi(`/api/alarm/TENANT/${this.tenantId}?pageSize=${pageSize}&page=0${query}`);
        if (tenantAlarms.data) allAlarms = [...tenantAlarms.data];
      } catch (e) {
        console.warn("Error fetching tenant alarms");
      }
    }

    // Como vimos que algunas no se propagan, buscamos específicamente en los dispositivos activos
    try {
      const devices = await this.getDevices(20);
      const activeDevices = devices.filter(d => d.online || d.name === 'ESP32-IO'); // Priorizamos el ESP32-IO
      
      const deviceAlarmsPromises = activeDevices.map(async (d) => {
        try {
          const res = await this.fetchApi(`/api/alarm/DEVICE/${d.id.id}?pageSize=10&page=0${query}`);
          return res.data || [];
        } catch {
          return [];
        }
      });
      
      const results = await Promise.all(deviceAlarmsPromises);
      results.forEach(alarms => {
        alarms.forEach((alarm: Alarm) => {
          if (!allAlarms.find(a => a.id.id === alarm.id.id)) {
            allAlarms.push(alarm);
          }
        });
      });
    } catch (e) {
      console.warn("Error fetching per-device alarms");
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
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const msg = {
        alarmSubCmds: [
          {
            entityType: 'TENANT',
            entityId: 'tenant-id', // This needs careful config or fetching tenant id
            cmdId
          }
        ]
      };
      // Note: Tenant ID is usually fetched after login from /api/auth/user
      this.socket.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.socket?.close();
  }
}

export const tbService = new ThingsBoardService();
