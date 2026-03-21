import '@testing-library/jest-dom';

// Mock localStorage for tests
const store = {};
const localStorageMock = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => { store[key] = String(value); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i] || null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock Notification API
window.Notification = class {
  constructor(title, options) { this.title = title; this.options = options; }
  static permission = 'granted';
  static requestPermission = async () => 'granted';
};
