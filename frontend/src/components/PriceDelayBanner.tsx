
import Marquee from 'react-fast-marquee';

export default function PriceDelayBanner() {
  return (
    <div style={{
      width: '100%',
      background: '#f9d923',
      color: '#222',
      fontWeight: 'bold',
      fontSize: '1rem',
      padding: '8px 0',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      borderBottom: '1px solid #e3b800',
      letterSpacing: '0.02em',
      overflow: 'hidden',
    }}>
      <Marquee
        gradient={false}
        speed={40}
        pauseOnHover={true}
        style={{
          fontWeight: 'bold',
          fontSize: '1rem',
          color: '#222',
          letterSpacing: '0.02em',
        }}
      >
        ⚠️ Stock prices displayed are delayed by up to 15 minutes for normal users. To view real-time prices, subscribe to Elite version. All other data is real-time where available.
      </Marquee>
    </div>
  );
}
