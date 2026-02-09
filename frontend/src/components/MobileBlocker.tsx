
"use client";
import React, { useEffect, useState } from 'react';

export default function MobileBlocker() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check on mount and on resize
    function checkMobile() {
      setIsMobile(window.innerWidth <= 768);
    }
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!isMobile) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: '#0f172a',
      color: '#fff',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <img src="/404.png" alt="Under Construction" style={{ width: '300px', marginBottom: '2rem' }} />
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Website Under Development</h1>
      <p style={{ fontSize: '1.2rem', marginBottom: '2rem' }}>
        Mobile view is not yet supported.<br />
        Please access QuantTrade AI from a desktop or laptop for the best experience.
      </p>
    </div>
  );
}
