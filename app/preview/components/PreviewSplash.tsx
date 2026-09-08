import styles from "../preview.module.css";

export function PreviewSplash() {
  return (
    <section className={styles.splash} aria-label="Rubenius idle screen">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        <source src="/BG-VIDEO/Gates%20zone%201.0%20updated.mp4" type="video/mp4" />
      </video>
    </section>
  );
}
