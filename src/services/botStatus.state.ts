export interface BotStatus {
  isActive: boolean;
  lastPollTime: Date | null;
  version: string;
  pollingInProgress: boolean;
}

let currentStatus: BotStatus = {
  isActive: false,
  lastPollTime: null,
  version: '2026-05-09 07:30',
  pollingInProgress: false,
};

export function setBotStatus(status: Partial<BotStatus>) {
  currentStatus = { ...currentStatus, ...status };
}

export function getBotStatus(): BotStatus {
  return currentStatus;
}
