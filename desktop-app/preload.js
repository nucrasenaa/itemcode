const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('itemcodeDesktop', {
    checkRequirements: () => ipcRenderer.invoke('requirements:check'),
    downloadRequirement: (id) => ipcRenderer.invoke('requirements:download', id),
    openRequirementHelp: (id) => ipcRenderer.invoke('requirements:help', id),
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    start: (settings) => ipcRenderer.invoke('service:start', settings),
    testLogin: (settings) => ipcRenderer.invoke('service:test-login', settings),
    testItemcode: (payload) => ipcRenderer.invoke('service:test-itemcode', payload),
    testTelegram: (settings) => ipcRenderer.invoke('telegram:test', settings),
    stop: () => ipcRenderer.invoke('service:stop'),
    getServiceState: () => ipcRenderer.invoke('service:state'),
    onRequirementsUpdate: (callback) => {
        const listener = (_event, requirements) => callback(requirements);
        ipcRenderer.on('requirements:update', listener);
        return () => ipcRenderer.removeListener('requirements:update', listener);
    },
    onServiceState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('service:state', listener);
        return () => ipcRenderer.removeListener('service:state', listener);
    },
    onItemcodeEvent: (callback) => {
        const listener = (_event, event) => callback(event);
        ipcRenderer.on('service:itemcode', listener);
        return () => ipcRenderer.removeListener('service:itemcode', listener);
    }
});
