// Mock system-level modules to prevent side effects during unit tests
jest.mock('child_process');
jest.mock('fs');
// WebSocket is handled via PowerShell in this project, so we don't need a direct 'ws' mock in setup
