import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Activity, 
  AlertCircle, 
  Bell, 
  CheckCircle2, 
  Cpu, 
  LogOut, 
  Settings, 
  ShieldAlert, 
  LayoutDashboard,
  RefreshCw,
  X,
  Lock,
  Server,
  User,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { tbService } from './services/tbService';
import { Alarm, Device, AlarmSeverity } from './types';
import { cn, formatTimestamp, SEVERITY_COLORS } from './lib/utils';
import { useNotifications } from './hooks/useNotifications';

// --- Sub-components ---

const SeverityBadge = ({ severity }: { severity: AlarmSeverity }) => (
  <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold uppercase", SEVERITY_COLORS[severity])}>
    {severity}
  </span>
);

const FullScreenAlarm = ({ alarm, onDismiss, onAck, onClear }: { 
  alarm: Alarm; 
  onDismiss: () => void;
  onAck: (id: string) => Promise<void>;
  onClear: (id: string) => Promise<void>;
}) => (
  <motion.div 
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4"
  >
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-0 left-0 w-full h-full opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-red-600 via-transparent to-transparent animate-pulse" />
    </div>

    <motion.div 
      initial={{ scale: 0.8, y: 20 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.8, y: 20 }}
      className="relative w-full max-w-2xl bg-zinc-900 border-2 border-red-500 rounded-3xl p-8 text-center shadow-[0_0_50px_rgba(239,68,68,0.3)]"
    >
      <div className="flex justify-center mb-6">
        <div className="p-5 bg-red-500/10 rounded-full animate-bounce">
          <ShieldAlert className="w-16 h-16 text-red-500" />
        </div>
      </div>
      
      <h1 className="text-4xl font-black text-white mb-2 tracking-tighter uppercase italic">
        Alarma Crítica Detectada
      </h1>
      <p className="text-red-400 font-mono text-xl mb-8">
        {alarm.type.replace(/_/g, ' ')}
      </p>

      <div className="space-y-4 mb-10 text-left bg-zinc-800/50 p-6 rounded-2xl border border-zinc-700">
        <div className="flex justify-between items-center border-b border-zinc-700 pb-2">
          <span className="text-zinc-400 text-sm">Dispositivo</span>
          <span className="text-white font-medium">{alarm.originatorName}</span>
        </div>
        <div className="flex justify-between items-center border-b border-zinc-700 pb-2">
          <span className="text-zinc-400 text-sm">Hora</span>
          <span className="text-white font-medium">{formatTimestamp(alarm.createdTime)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-400 text-sm">Estado</span>
          <SeverityBadge severity={alarm.severity} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => onAck(alarm.id.id)}
          className="py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold transition-all active:scale-95 border border-zinc-700"
        >
          Reconocer
        </button>
        <button
          onClick={() => onClear(alarm.id.id)}
          className="py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold transition-all active:scale-95"
        >
          Resolver
        </button>
        <button
          onClick={onDismiss}
          className="py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-red-900/40"
        >
          Silenciar (10s)
        </button>
      </div>
    </motion.div>
  </motion.div>
);

// --- Main App ---

type AppView = 'dashboard' | 'devices' | 'alarms' | 'settings';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loginData, setLoginData] = useState({ user: '', pass: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [criticalAlarm, setCriticalAlarm] = useState<Alarm | null>(null);
  const [lastDismissedTime, setLastDismissedTime] = useState<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { showNotification, requestPermission, permission } = useNotifications();

  const DEFAULT_URL = 'http://cumuloingenieria.duckdns.org:9090';

  // Polling for updates (Simplification instead of full dynamic WS for now)
  const fetchData = useCallback(async () => {
    try {
      // Pedimos todas las alarmas (sin filtrar por unack únicamente) y todos los dispositivos
      const [newAlarms, newDevices] = await Promise.all([
        tbService.getAlarms(20), 
        tbService.getDevices(50)
      ]);
      
      console.log(`Datos actualizados: ${newAlarms.length} alarmas, ${newDevices.length} dispositivos`);

      // Check for new critical alarms
      const latestCritical = newAlarms.find(a => a.severity === 'CRITICAL' && a.status.includes('UNACK'));
      
      // Delay de 10 segundos antes de volver a mostrar una alarma silenciada
      const waitTimePassed = Date.now() - lastDismissedTime > 10000;

      if (latestCritical && waitTimePassed) {
        if (!criticalAlarm || latestCritical.id.id !== criticalAlarm.id.id) {
          setCriticalAlarm(latestCritical);
          showNotification(`ALERTA CRÍTICA: ${latestCritical.originatorName}`, {
            body: latestCritical.type,
            tag: latestCritical.id.id
          });
        }
      } else if (!latestCritical) {
        setCriticalAlarm(null);
      }

      setAlarms(newAlarms);
      setDevices(newDevices);
    } catch (error) {
      console.error("Fetch error in background:", error);
    }
  }, [criticalAlarm, showNotification, lastDismissedTime]);

  const autoLogin = async (user: string, pass: string) => {
    setIsLoading(true);
    try {
      tbService.setBaseUrl(DEFAULT_URL);
      await tbService.login(user, pass);
      setIsAuthenticated(true);
    } catch (err) {
      setErrorMessage("Sesión memorizada pero falló la conexión automática.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      tbService.setBaseUrl(DEFAULT_URL);
      await tbService.login(loginData.user, loginData.pass);
      
      if (rememberMe) {
        localStorage.setItem('cumulo_user', loginData.user);
        localStorage.setItem('cumulo_pass', loginData.pass);
      } else {
        localStorage.removeItem('cumulo_user');
        localStorage.removeItem('cumulo_pass');
      }

      setIsAuthenticated(true);
      requestPermission();
    } catch (err: any) {
      console.error("Login Error:", err);
      setErrorMessage(err.message || "Error al iniciar sesión.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      // Simulación de validación biométrica/dispositivo para mayor realismo/seguridad percibida
      // En un entorno web sin backend de llaves, usamos esto para requerir el PIN/Huella del movil
      if (window.PublicKeyCredential) {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        
        // Esto disparará el prompt de biometría/bloqueo de pantalla del móvil
        await navigator.credentials.get({
          publicKey: {
            challenge,
            timeout: 60000,
            userVerification: "required",
            rpId: window.location.hostname
          }
        });
        
        const savedUser = localStorage.getItem('cumulo_user');
        const savedPass = localStorage.getItem('cumulo_pass');
        if (savedUser && savedPass) {
          handleLogin();
        }
      }
    } catch (e) {
      console.warn("Biometría cancelada o fallida", e);
      // Si falla biometría, simplemente que use el botón normal
    }
  };

  useEffect(() => {
    // Verificar soporte biometrico
    if (window.PublicKeyCredential) {
      setIsBiometricSupported(true);
    }

    // Auto-login logic
    const savedUser = localStorage.getItem('cumulo_user');
    const savedPass = localStorage.getItem('cumulo_pass');
    
    if (savedUser && savedPass) {
      setLoginData({ user: savedUser, pass: savedPass });
      setRememberMe(true);
      // If we have saved credentials, trigger biometric prompt on startup as requested
      if (window.PublicKeyCredential) {
        handleBiometricLogin();
      } else {
        autoLogin(savedUser, savedPass);
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchData]);

  const handleAck = async (id: string) => {
    try {
      await tbService.acknowledgeAlarm(id);
      if (criticalAlarm?.id.id === id) setCriticalAlarm(null);
      fetchData();
    } catch (e) {
      alert("Error al reconocer");
    }
  };

  const handleClear = async (id: string) => {
    try {
      await tbService.clearAlarm(id);
      if (criticalAlarm?.id.id === id) setCriticalAlarm(null);
      fetchData();
    } catch (e) {
      alert("Error al limpiar");
    }
  };

  const handleDismiss = () => {
    setCriticalAlarm(null);
    setLastDismissedTime(Date.now());
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 selection:bg-red-500/30">
        <div className="scanline" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(220,38,38,0.4)]">
              <ShieldAlert className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase">Cumulo IOT Alertas</h1>
            <p className="text-zinc-500 text-sm">Monitoreo Industrial</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <AnimatePresence>
              {errorMessage && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl text-red-500 text-xs font-medium"
                >
                  {errorMessage}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase ml-2 tracking-widest">USUARIO (correo electronico)</label>
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-red-500 transition-colors" />
                  <input 
                    type="text" 
                    required
                    placeholder="ej: tenant@thingsboard.org"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-12 pr-4 py-4 text-white focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all font-medium"
                    value={loginData.user}
                    onChange={e => setLoginData({...loginData, user: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-500 uppercase ml-2 tracking-widest">CONTRASEÑA</label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-red-500 transition-colors" />
                  <input 
                    type="password" 
                    required
                    placeholder="••••••••"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-12 pr-4 py-4 text-white focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all font-medium"
                    value={loginData.pass}
                    onChange={e => setLoginData({...loginData, pass: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-5 h-5 rounded-lg bg-zinc-950 border-zinc-800 text-red-600 focus:ring-0 focus:ring-offset-0 transition-all"
                  />
                  <span className="text-zinc-400 text-xs group-hover:text-white transition-colors">Recordar credenciales</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button 
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg shadow-red-900/20 active:scale-95 flex items-center justify-center gap-3"
              >
                {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <>Entrar <ChevronRight className="w-5 h-5" /></>}
              </button>

              {isBiometricSupported && localStorage.getItem('cumulo_user') && (
                <button 
                  type="button"
                  onClick={handleBiometricLogin}
                  className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border border-zinc-700 flex items-center justify-center gap-2"
                >
                  <Activity className="w-4 h-4 text-red-500" />
                  Desbloqueo Biométrico
                </button>
              )}
            </div>
          </form>

          <div className="mt-8 pt-8 border-t border-zinc-800/50 text-center flex flex-col items-center gap-1">
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">www.cumuloingenieria.com.ar</p>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">ventas@cumuloingenieria.com.ar</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex overflow-hidden">
      <AnimatePresence>
        {criticalAlarm && (
          <FullScreenAlarm 
            alarm={criticalAlarm} 
            onDismiss={handleDismiss} 
            onAck={handleAck}
            onClear={handleClear}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={cn(
        "bg-zinc-900 border-r border-zinc-800 transition-all duration-300 flex flex-col",
        sidebarOpen ? "w-72" : "w-20"
      )}>
        <div className="p-6 flex items-center gap-4">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-red-900/20">
            <Activity className="w-6 h-6 text-white" />
          </div>
          {sidebarOpen && <span className="font-black tracking-tight text-xl italic uppercase font-mono">CUMULO.IOT</span>}
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2">
          <NavItem 
            active={currentView === 'dashboard'} 
            icon={<LayoutDashboard />} 
            label="Dashboard" 
            expanded={sidebarOpen} 
            onClick={() => setCurrentView('dashboard')}
          />
          <NavItem 
            active={currentView === 'devices'} 
            icon={<Cpu />} 
            label="Dispositivos" 
            expanded={sidebarOpen} 
            onClick={() => setCurrentView('devices')}
          />
          <NavItem 
            active={currentView === 'alarms'} 
            icon={<Bell />} 
            label="Alertas" 
            expanded={sidebarOpen} 
            onClick={() => setCurrentView('alarms')}
          />
          <NavItem 
            active={currentView === 'settings'} 
            icon={<Settings />} 
            label="Ajustes" 
            expanded={sidebarOpen} 
            onClick={() => setCurrentView('settings')}
          />
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <button 
            onClick={() => setIsAuthenticated(false)}
            className="w-full flex items-center gap-4 p-4 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-2xl transition-all"
          >
            <LogOut className="w-6 h-6" />
            {sidebarOpen && <span className="font-bold">Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950">
        <header className="p-6 flex justify-between items-center bg-zinc-950/50 backdrop-blur-md border-b border-zinc-800">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-zinc-800 rounded-xl transition-colors"
            >
              <LayoutDashboard className="w-6 h-6 text-zinc-400" />
            </button>
            <h2 className="text-xl font-bold">Vista de Supervisión</h2>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Estado Sistema</span>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                <span className="text-sm font-medium text-emerald-500">Conectado</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <User className="w-5 h-5 text-zinc-400" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {currentView === 'dashboard' && (
            <>
              {/* Stats Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={<AlertCircle />} label="Alarmas Activas" value={alarms.length} color="text-red-500" />
                <StatCard icon={<Cpu />} label="Dispositivos Online" value={devices.filter(d => d.online).length} color="text-emerald-500" />
                <StatCard icon={<LayoutDashboard />} label="Alertas Críticas" value={alarms.filter(a => a.severity === 'CRITICAL').length} color="text-red-600" />
                <StatCard icon={<Activity />} label="Total Dispositivos" value={devices.length} color="text-blue-500" />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Alarms Feed - Limited to 5 for Dashboard */}
                <section className="xl:col-span-2 space-y-4">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                      <ShieldAlert className="w-8 h-8 text-red-500" />
                      Panel de Alarmas
                    </h3>
                    <button 
                      onClick={() => setCurrentView('alarms')}
                      className="text-red-500 text-sm font-bold hover:underline"
                    >
                      Ver todas
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    {alarms.length === 0 ? (
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-12 text-center">
                        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4 opacity-50" />
                        <p className="text-zinc-500 font-medium">Sitema despejado. No hay alarmas pendientes.</p>
                      </div>
                    ) : (
                      alarms.slice(0, 5).map(alarm => (
                        <AlarmCard 
                          key={alarm.id.id} 
                          alarm={alarm} 
                          onAck={handleAck} 
                          onClear={handleClear} 
                        />
                      ))
                    )}
                  </div>
                </section>

                {/* Devices Sidebar - Limited to 8 for Dashboard */}
                <section className="space-y-6">
                  <h3 className="text-xl font-bold flex items-center gap-3">
                    <Cpu className="w-6 h-6 text-blue-500" />
                    Dispositivos Online
                  </h3>
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden shadow-inner">
                    {devices.length === 0 ? (
                      <div className="p-12 text-center">
                        <Cpu className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
                        <p className="text-zinc-500 text-sm">No hay dispositivos.</p>
                      </div>
                    ) : (
                      devices.slice(0, 8).map((device, idx) => (
                        <DeviceRow 
                          key={device.id.id} 
                          device={device} 
                          isLast={idx === Math.min(devices.length, 8) - 1} 
                        />
                      ))
                    )}
                  </div>
                  <button 
                    onClick={() => setCurrentView('devices')}
                    className="w-full py-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold text-zinc-400 hover:text-white transition-all"
                  >
                    Ver Todos <ExternalLink className="w-4 h-4" />
                  </button>
                </section>
              </div>
            </>
          )}

          {currentView === 'devices' && (
            <section className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-3xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                  <Cpu className="w-10 h-10 text-blue-500" />
                  Todos los Dispositivos
                </h3>
                <div className="bg-zinc-900 px-4 py-2 rounded-xl border border-zinc-800 text-sm font-mono">
                   Total: {devices.length}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {devices.map(device => (
                  <div key={device.id.id} className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl hover:border-zinc-600 transition-all group">
                    <div className="flex justify-between items-start mb-6">
                      <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center group-hover:bg-blue-600/20 group-hover:text-blue-500 transition-colors">
                        <Cpu className="w-6 h-6" />
                      </div>
                      <div className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase",
                        device.online ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                      )}>
                        {device.online ? "Online" : "Offline"}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xl font-bold mb-1">{device.name}</h4>
                      <p className="text-zinc-500 text-sm font-mono uppercase tracking-widest">{device.type}</p>
                    </div>
                    <div className="mt-6 pt-6 border-t border-zinc-800 flex justify-between items-center">
                      <span className="text-xs text-zinc-500">ID: {device.id.id.slice(0, 8)}...</span>
                      <ExternalLink className="w-4 h-4 text-zinc-600" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {currentView === 'alarms' && (
            <section className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-3xl font-black italic uppercase tracking-tighter flex items-center gap-3">
                  <ShieldAlert className="w-10 h-10 text-red-500" />
                  Historial de Alertas
                </h3>
                <div className="flex gap-2">
                  <button onClick={fetchData} className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl hover:bg-zinc-800 text-zinc-400">
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                {alarms.map(alarm => (
                  <AlarmCard 
                    key={alarm.id.id} 
                    alarm={alarm} 
                    onAck={handleAck} 
                    onClear={handleClear} 
                  />
                ))}
                {alarms.length === 0 && (
                  <div className="p-20 text-center bg-zinc-900/30 border border-dashed border-zinc-800 rounded-3xl">
                     <Bell className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
                     <p className="text-zinc-500">No se encontraron alertas recientes.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {currentView === 'settings' && (
            <section className="max-w-2xl mx-auto space-y-10 py-10">
              <div>
                <h3 className="text-4xl font-black italic uppercase tracking-tighter mb-2">Configuración</h3>
                <p className="text-zinc-500">Preferencias del sistema y gestión del Gateway.</p>
              </div>
              
              <div className="space-y-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
                  <h4 className="font-bold flex items-center gap-2">
                    <Server className="w-5 h-5 text-red-500" />
                    Información del Servidor
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <p className="text-[10px] text-zinc-500 uppercase font-black mb-1">URL Base</p>
                        <p className="text-sm font-mono text-white">{tbService.getBaseUrl() || 'No disponible'}</p>
                     </div>
                     <div>
                        <p className="text-[10px] text-zinc-500 uppercase font-black mb-1">Estado Conexión</p>
                        <p className="text-sm text-emerald-500 font-bold">Activo</p>
                     </div>
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
                  <h4 className="font-bold flex items-center gap-2">
                    <Bell className="w-5 h-5 text-blue-500" />
                    Notificaciones
                  </h4>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                       <div>
                          <p className="text-sm font-bold">Estado: {
                            permission === 'granted' ? 'Habilitadas' : 
                            permission === 'denied' ? 'Bloqueadas' : 'Pendientes'
                          }</p>
                          <p className="text-xs text-zinc-500">Alertas críticas incluso en segundo plano o celular bloqueado.</p>
                       </div>
                       <button 
                          onClick={() => requestPermission()}
                          className={cn(
                            "w-12 h-6 rounded-full relative transition-colors",
                            permission === 'granted' ? "bg-emerald-600" : "bg-zinc-700"
                          )}
                       >
                          <div className={cn(
                            "absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all",
                            permission === 'granted' ? "right-1" : "left-1"
                          )} />
                       </button>
                    </div>
                    {permission === 'granted' && (
                      <button 
                        onClick={() => showNotification('Prueba de Notificación', { body: 'Si ves esto, las alertas están configuradas correctamente.', tag: 'test' })}
                        className="text-[10px] text-zinc-500 hover:text-white underline uppercase tracking-widest text-left"
                      >
                        Enviar notificación de prueba
                      </button>
                    )}
                  </div>
                  {permission === 'denied' && (
                    <p className="text-[10px] text-red-500 font-bold uppercase italic">
                      Debes habilitar los permisos manualmente en los ajustes de tu navegador.
                    </p>
                  )}
                </div>

                <button 
                  onClick={() => setIsAuthenticated(false)}
                  className="w-full py-4 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/20 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  <LogOut className="w-5 h-5" />
                  Cerrar Sesión Segura
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

// --- Utils ---

function AlarmCard({ alarm, onAck, onClear }: { 
  alarm: Alarm; 
  onAck: (id: string) => Promise<void>; 
  onClear: (id: string) => Promise<void>;
}) {
  return (
    <motion.div 
      layout
      className={cn(
        "bg-zinc-900 border-l-4 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all border-zinc-800",
        alarm.severity === 'CRITICAL' && "border-l-red-600 bg-red-950/10"
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3 mb-1">
          <SeverityBadge severity={alarm.severity} />
          <span className="text-zinc-500 text-xs font-mono">{formatTimestamp(alarm.createdTime)}</span>
        </div>
        <h4 className="text-lg font-bold text-white capitalize">{alarm.type.replace(/_/g, ' ')}</h4>
        <p className="text-zinc-400 text-sm flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5" />
          {alarm.originatorName}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button 
          onClick={() => onAck(alarm.id.id)}
          className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-bold transition-all active:scale-95 border border-zinc-700"
        >
          Reconocer
        </button>
        <button 
          onClick={() => onClear(alarm.id.id)}
          className="px-6 py-3 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-500 hover:text-white border border-emerald-500/20 rounded-xl text-sm font-bold transition-all active:scale-95"
        >
          Resolver
        </button>
      </div>
    </motion.div>
  );
}

function DeviceRow({ device, isLast }: { device: Device; isLast: boolean }) {
  return (
    <div className={cn(
      "p-4 flex items-center justify-between hover:bg-zinc-800 transition-colors cursor-pointer group",
      !isLast && "border-b border-zinc-800"
    )}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center group-hover:bg-zinc-700 transition-colors">
          <Cpu className="w-5 h-5 text-zinc-500" />
        </div>
        <div>
          <p className="text-sm font-bold">{device.name}</p>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{device.type}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full",
          device.online ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : "bg-zinc-700"
        )} />
        <span className={cn(
          "text-[10px] font-bold tracking-tighter",
          device.online ? "text-emerald-500" : "text-zinc-500"
        )}>
          {device.online ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, expanded, onClick }: { 
  icon: any; 
  label: string; 
  active?: boolean; 
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold",
        active ? "bg-red-600 text-white shadow-lg shadow-red-900/20" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      {expanded && <span>{label}</span>}
    </button>
  );
}

function StatCard({ icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-xl">
      <div className={cn("p-3 bg-zinc-800 w-fit rounded-2xl", color)}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-6 h-6' })}
      </div>
      <div>
        <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">{label}</p>
        <p className="text-3xl font-black tracking-tight">{value}</p>
      </div>
    </div>
  );
}
