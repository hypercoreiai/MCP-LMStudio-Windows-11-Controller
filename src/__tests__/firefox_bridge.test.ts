import { registry } from '../core/registry';
import '../tools/firefox_bridge';
import { execSync } from 'child_process';
import { TsdLoader } from '../core/tsd/loader';

jest.mock('child_process');
jest.mock('../core/tsd/loader');

describe('Firefox Bridge', () => {
  const mockExecSync = execSync as jest.Mock;

  beforeAll(() => {
    // Basic initialization to satisfy the registry guard
    registry.init({ transportMode: 'stdio' } as any, new TsdLoader());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should attempt to connect to localhost:9222 for element discovery', async () => {
    // Mock PowerShell returning a JSON-like string for WS communication
    // Note: The script uses UTF16LE encoding for PowerShell -EncodedCommand
    mockExecSync.mockReturnValue(JSON.stringify({
      result: {
        result: {
          value: JSON.stringify([{ x: 10, y: 20, width: 100, height: 50, name: 'input' }])
        }
      }
    }));

    const result = await registry.invoke({
      tool: 'firefox.get_elements',
      args: { selector: 'input' },
      meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now() }
    });

    expect(result.success).toBe(true);
    
    // The command is now Base64 encoded, so we decode it for inspection
    const encodedCommand = mockExecSync.mock.calls[0][0].split(' -EncodedCommand ')[1];
    const decodedCommand = Buffer.from(encodedCommand, 'base64').toString('utf16le');
    
    expect(decodedCommand).toContain('9222');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('powershell'),
      expect.anything()
    );
  });

  it('should handle JS execution errors gracefully', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('WebSocket timeout');
    });

    const result = await registry.invoke({
      tool: 'firefox.execute_js',
      args: { code: 'alert(1)' },
      meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now() }
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });
});
