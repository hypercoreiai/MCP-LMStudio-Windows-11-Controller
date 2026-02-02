const { execSync } = require('child_process');

try {
  const result = execSync('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Write-Host Hello"', { encoding: 'utf-8', timeout: 5000 });
  console.log('Success:', result.trim());
} catch (e) {
  console.log('Error:', e.message);
  console.log('Stderr:', e.stderr?.toString());
  console.log('Stdout:', e.stdout?.toString());
}