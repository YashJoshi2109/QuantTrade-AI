'use client'

import styled, { createGlobalStyle } from 'styled-components'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

const GlobalStyle = createGlobalStyle`
  .toggle--checkbox {
    display: none;
  }

  .toggle--checkbox:checked + .toggle--btn {
    background: #183153;
  }

  .toggle--checkbox:checked + .toggle--btn::before {
    background: #183153;
  }

  .toggle--checkbox:checked + .toggle--btn .toggle--btn-inner {
    right: calc(var(--toggle-size) * 0.1);
    left: auto;
  }

  .toggle--checkbox:checked + .toggle--btn .toggle--btn-inner::after {
    opacity: 0;
  }

  .toggle--checkbox:checked + .toggle--btn .toggle--features {
    color: transparent;
    text-shadow: var(--toggle-size) calc(var(--toggle-size) * 0.375) 0 #fff;
    background-color: #2b4a7a;
  }

  .toggle--checkbox:checked + .toggle--btn .toggle--features::before {
    width: calc(var(--toggle-size) * 0.5);
    height: calc(var(--toggle-size) * 0.1875);
    top: calc(var(--toggle-size) * 0.3125);
    left: calc(var(--toggle-size) * 0.375);
    background-color: #4d78ab;
    box-shadow:
      calc(var(--toggle-size) * -0.625) calc(var(--toggle-size) * 0.0625) 0 calc(var(--toggle-size) * 0.0625) #fff,
      calc(var(--toggle-size) * -0.625) calc(var(--toggle-size) * 0.25) 0 0 rgba(255, 255, 255, 0.3),
      calc(var(--toggle-size) * -1.125) 0 0 0 rgba(255, 255, 255, 0.3),
      calc(var(--toggle-size) * -1.125) calc(var(--toggle-size) * 0.1875) 0 0 rgba(255, 255, 255, 0.3);
  }

  .toggle--checkbox:checked + .toggle--btn .toggle--features::after {
    width: calc(var(--toggle-size) * 0.125);
    height: calc(var(--toggle-size) * 0.125);
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    top: calc(var(--toggle-size) * 0.0625);
    left: calc(var(--toggle-size) * 0.125);
    box-shadow:
      calc(var(--toggle-size) * 0.375) calc(var(--toggle-size) * 0.5) 0 0 rgba(255, 255, 255, 0.3),
      calc(var(--toggle-size) * 0.8125) calc(var(--toggle-size) * 0.1875) 0 calc(var(--toggle-size) * 0.0625) rgba(255, 255, 255, 0.2),
      calc(var(--toggle-size) * 0.625) 0 0 calc(var(--toggle-size) * 0.03125) rgba(255, 255, 255, 0.4),
      calc(var(--toggle-size) * 1) calc(var(--toggle-size) * 0.3125) 0 0 rgba(255, 255, 255, 0.2);
  }
`

const ToggleWrapper = styled.div`
  --toggle-size: 16px;

  .toggle--btn {
    width: calc(var(--toggle-size) * 3.75);
    height: calc(var(--toggle-size) * 1.875);
    border-radius: calc(var(--toggle-size) * 0.9375);
    background: #9fc5e8;
    cursor: pointer;
    display: block;
    position: relative;
    overflow: hidden;
    transition: background 0.3s ease;
  }

  .toggle--btn::before {
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.4) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    position: absolute;
    top: 0;
    left: 0;
    border-radius: inherit;
    transition: background 0.3s ease;
  }

  .toggle--btn-inner {
    width: calc(var(--toggle-size) * 1.5);
    height: calc(var(--toggle-size) * 1.5);
    border-radius: 50%;
    background: white;
    position: absolute;
    top: calc(var(--toggle-size) * 0.1875);
    left: calc(var(--toggle-size) * 0.1);
    transition: left 0.3s ease, right 0.3s ease;
    overflow: hidden;
    box-shadow: 0 0 0 calc(var(--toggle-size) * 0.0625) rgba(0, 0, 0, 0.15);
  }

  .toggle--btn-inner::after {
    content: '';
    display: block;
    width: 60%;
    height: 60%;
    border-radius: 50%;
    position: absolute;
    top: 10%;
    right: 10%;
    background: #e8e8e8;
    transition: opacity 0.3s ease;
  }

  .toggle--features {
    width: calc(var(--toggle-size) * 0.4375);
    height: calc(var(--toggle-size) * 0.4375);
    background-color: #ffda00;
    border-radius: 50%;
    position: absolute;
    right: calc(var(--toggle-size) * 0.4375);
    top: 50%;
    transform: translateY(-50%);
    color: #ffda00;
    text-shadow: 0 0 0 #ffda00;
    transition:
      color 0.3s ease,
      text-shadow 0.3s ease,
      background-color 0.3s ease;
    box-shadow: 0 0 calc(var(--toggle-size) * 0.25) rgba(255, 218, 0, 0.7);
  }

  .toggle--features::before {
    content: '';
    display: block;
    position: absolute;
    width: calc(var(--toggle-size) * 0.125);
    height: calc(var(--toggle-size) * 0.125);
    border-radius: calc(var(--toggle-size) * 0.0625);
    background-color: #9fc5e8;
    top: calc(var(--toggle-size) * 0.5);
    left: calc(var(--toggle-size) * 0.125);
    transition:
      width 0.3s ease,
      height 0.3s ease,
      top 0.3s ease,
      left 0.3s ease,
      background-color 0.3s ease,
      box-shadow 0.3s ease;
    box-shadow: calc(var(--toggle-size) * 0.4375) 0 0 0 #9fc5e8;
  }

  .toggle--features::after {
    content: '';
    display: block;
    position: absolute;
    border-radius: 50%;
    width: calc(var(--toggle-size) * 0.25);
    height: calc(var(--toggle-size) * 0.25);
    top: calc(var(--toggle-size) * -0.625);
    left: calc(var(--toggle-size) * 0.5);
    background-color: rgba(255, 255, 255, 0.4);
    box-shadow:
      calc(var(--toggle-size) * 0.1875) calc(var(--toggle-size) * 0.625) 0 0 rgba(255, 255, 255, 0.4),
      calc(var(--toggle-size) * -0.125) calc(var(--toggle-size) * 0.375) 0 calc(var(--toggle-size) * 0.0625) rgba(255, 255, 255, 0.3),
      calc(var(--toggle-size) * 0.125) 0 0 0 rgba(255, 255, 255, 0.4);
    transition:
      width 0.3s ease,
      height 0.3s ease,
      top 0.3s ease,
      left 0.3s ease,
      background-color 0.3s ease,
      box-shadow 0.3s ease;
  }
`

export function BB8ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div style={{ width: 60, height: 30 }} />
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <ToggleWrapper>
      <GlobalStyle />
      <input
        id="bb8-theme-toggle"
        className="toggle--checkbox"
        type="checkbox"
        checked={isDark}
        onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      />
      <label className="toggle--btn" htmlFor="bb8-theme-toggle">
        <span className="toggle--btn-inner" />
        <span className="toggle--features" />
      </label>
    </ToggleWrapper>
  )
}
