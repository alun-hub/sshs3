// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ClampedNumberInput } from '../../src/renderer/src/components/SettingsModal/ClampedNumberInput';

function Harness({ initial, onChange }: { initial: number; onChange: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ClampedNumberInput
        aria-label="Size"
        min={8}
        max={32}
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
      <span data-testid="stored">{value}</span>
    </>
  );
}

function setup(initial = 13) {
  const onChange = vi.fn();
  render(<Harness initial={initial} onChange={onChange} />);
  const input = screen.getByRole('spinbutton', { name: 'Size' }) as HTMLInputElement;
  const type = (text: string) => fireEvent.change(input, { target: { value: text } });
  return { input, onChange, type, stored: () => screen.getByTestId('stored').textContent };
}

describe('ClampedNumberInput', () => {
  afterEach(cleanup);

  it('can be typed into digit by digit: "1" is shown although it is below the minimum, and "16" is passed on', () => {
    const { input, onChange, type, stored } = setup();

    type('1');
    expect(input.value).toBe('1');
    expect(onChange).not.toHaveBeenCalled();
    expect(stored()).toBe('13');

    type('16');
    expect(input.value).toBe('16');
    expect(onChange).toHaveBeenCalledWith(16);
    expect(stored()).toBe('16');
  });

  it('settles a number below the minimum on the minimum when the field is left', () => {
    const { input, onChange, type, stored } = setup();
    type('2');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(8);
    expect(input.value).toBe('8');
    expect(stored()).toBe('8');
  });

  it('never passes on a number above the maximum while typing, and settles on the maximum when the field is left', () => {
    const { input, onChange, type } = setup();
    type('99');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(32);
    expect(input.value).toBe('32');
  });

  it('goes back to the stored value when the field is left empty', () => {
    const { input, onChange, type, stored } = setup(20);
    type('');
    expect(input.value).toBe('');
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('20');
    expect(stored()).toBe('20');
  });

  it('does not take a decimal number', () => {
    const { input, onChange, type } = setup(20);
    type('1.5');
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('20');
  });

  it('follows the stored value again after the field is left', () => {
    const { input, type, stored } = setup();
    type('21');
    fireEvent.blur(input);
    expect(stored()).toBe('21');
    expect(input.value).toBe('21');
  });
});
