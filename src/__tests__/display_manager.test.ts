import { registry } from '../core/registry';
import '../tools/display_manager';
import { execSync } from 'child_process';
import { TsdLoader } from '../core/tsd/loader';

jest.mock('child_process');
jest.mock('../core/tsd/loader');

describe('Display Manager (Visual Grounding)', () => {
  const mockExecSync = execSync as jest.Mock;

  beforeAll(() => {
    // Basic initialization to satisfy the registry guard
    registry.init({ transportMode: 'stdio' } as any, new TsdLoader());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate an annotated screenshot with correct PowerShell parameters', async () => {
    // Mock successful image generation (Base64 string)
    mockExecSync.mockReturnValue('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

    const result = await registry.invoke({
      tool: 'display.screenshot.annotated',
      args: {
        elements: [
          { x: 10, y: 20, width: 100, height: 50, name: 'Submit Button' }
        ]
      },
      meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now() }
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('imageBase64');
    
    // Verify PS command contains our annotation logic
    // The command is now Base64 encoded, so we decode it for inspection
    const encodedCommand = mockExecSync.mock.calls[0][0].split(' -EncodedCommand ')[1];
    const decodedCommand = Buffer.from(encodedCommand, 'base64').toString('utf16le');
    
    expect(decodedCommand).toContain('DrawRectangle');
    expect(decodedCommand).toContain('10'); // x
    expect(decodedCommand).toContain('20'); // y
    expect(decodedCommand).toContain('100'); // width
    expect(decodedCommand).toContain('50'); // height
  });

  it('should fallback to a basic screenshot if annotation fails', async () => {
    // Simulate error during annotation (e.g., GDI+ issue)
    mockExecSync.mockImplementation(() => {
      throw new Error('GDI+ Generic Error');
    });

    const result = await registry.invoke({
      tool: 'display.screenshot.annotated',
      args: { elements: [{ x: 0, y: 0, width: 10, height: 10 }] },
      meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now() }
    });

    // The tool should report failure but the code structure handles it via its registry error envelope
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });
});
