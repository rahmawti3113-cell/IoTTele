export interface ESP32State {
  relays: boolean[];
  variation: number; // 0, 1, 2
  delay: number; // 50 to 500
  notifTarget?: string;
  dht: {
    temperature: number;
    humidity: number;
  };
}
