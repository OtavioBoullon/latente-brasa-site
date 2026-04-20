import { motion } from "framer-motion";
import "./App.css";

import bg from "./assets/bg.png";
import hero from "./assets/hero.png";
import drink from "./assets/drink.png";
import lifestyle from "./assets/lifestyle.png";

const INSTAGRAM_URL =
  "https://www.instagram.com/latentebrasa?igsh=MXVkczNhMzVzcDM2NA%3D%3D&utm_source=qr";

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
};

export default function App() {
  const openInstagram = () => {
    window.open(INSTAGRAM_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="page"
      style={{
        backgroundImage: `linear-gradient(rgba(6,6,6,0.72), rgba(6,6,6,0.93)), url(${bg})`,
      }}
    >
      <div className="page-glow page-glow-1" />
      <div className="page-glow page-glow-2" />

      <header className="header">
        <button className="brand brand-button" onClick={openInstagram} type="button">
          <span className="dot" />
          <span className="brand-copy">
            <span className="brand-name">LATENTE BRASA</span>
            <span className="brand-sub">Nem tudo que queima é visível.</span>
          </span>
        </button>

        <button className="btn-outline" onClick={openInstagram} type="button">
          Instagram
        </button>
      </header>

      <main className="main">
        <section className="hero">
          <div className="container hero-grid">
            <motion.div className="hero-copy" {...fadeUp}>
              <p className="kicker">EXPERIÊNCIA • PRESENÇA • RITUAL</p>

              <h1 className="title">
                Não é sobre whisky.
                <span>É sobre presença.</span>
              </h1>

              <p className="subtitle">
                LATENTE BRASA nasce para quem percebe antes.
                <br />
                Antes do discurso.
                <br />
                Antes do excesso.
                <br />
                Antes do óbvio.
              </p>

              <div className="actions">
                <button className="btn-primary" onClick={openInstagram} type="button">
                  Acessar Instagram
                </button>

                <p className="note">
                  acesso inicial direcionado para quem chegou primeiro
                </p>
              </div>

              <div className="mini-points">
                <div className="mini-card">
                  <span>Presença</span>
                  <p>Uma marca construída para ser percebida, não anunciada.</p>
                </div>

                <div className="mini-card">
                  <span>Ritual</span>
                  <p>O gesto, o ambiente e a escolha importam tanto quanto o líquido.</p>
                </div>

                <div className="mini-card">
                  <span>Acesso</span>
                  <p>Contato direto, entrada controlada e narrativa premium desde o início.</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="hero-visual"
              initial={{ opacity: 0, scale: 0.96, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="image-box hero-box">
                <img src={hero} alt="Garrafa Latente Brasa" />
                <div className="overlay hero-overlay" />
                <div className="image-text">
                  <p>LATENTE BRASA</p>
                  <h3>Nem tudo que queima é visível.</h3>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <motion.section className="section section-tight" {...fadeUp}>
          <div className="container statement-shell">
            <div className="statement-line" />
            <div className="statement-grid">
              <div>
                <p className="tag">POSICIONAMENTO</p>
                <h2 className="section-title narrow">
                  Não foi feito para competir.
                  <br />
                  Foi feito para existir acima disso.
                </h2>
              </div>

              <div className="editorial-body">
                <p>LATENTE BRASA não tenta convencer.</p>
                <p>Ela separa.</p>
                <p>O que você sente aqui não vem só do sabor.</p>
                <p>Vem da imagem, da escolha, do silêncio e da percepção.</p>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section className="section" {...fadeUp}>
          <div className="container">
            <div className="section-header">
              <div>
                <p className="tag">DIREÇÃO VISUAL</p>
                <h2 className="section-title">
                  Não acompanha o momento.
                  <br />
                  Define o tom dele.
                </h2>
              </div>
            </div>

            <div className="gallery">
              <motion.article
                className="card card-large"
                whileHover={{ y: -6 }}
                transition={{ duration: 0.28 }}
              >
                <img src={drink} alt="Whisky servido em copo com gelo" />
                <div className="overlay" />
                <div className="card-text">
                  <p>RITUAL</p>
                  <h3>
                    O gesto muda tudo.
                    <br />
                    E quem sabe, sabe.
                  </h3>
                </div>
              </motion.article>

              <motion.article
                className="card"
                whileHover={{ y: -6 }}
                transition={{ duration: 0.28 }}
              >
                <img src={hero} alt="Produto Latente Brasa" />
                <div className="overlay" />
                <div className="card-text">
                  <p>PRODUTO</p>
                  <h3>
                    Presença não se explica.
                    <br />
                    Se percebe.
                  </h3>
                </div>
              </motion.article>

              <motion.article
                className="card"
                whileHover={{ y: -6 }}
                transition={{ duration: 0.28 }}
              >
                <img src={lifestyle} alt="Lifestyle Latente Brasa" />
                <div className="overlay" />
                <div className="card-text">
                  <p>LIFESTYLE</p>
                  <h3>
                    Não entra no ambiente.
                    <br />
                    Eleva.
                  </h3>
                </div>
              </motion.article>
            </div>
          </div>
        </motion.section>

        <motion.section className="section" {...fadeUp}>
          <div className="container perception-shell">
            <p className="tag">PERCEPÇÃO</p>
            <h2 className="section-title wide">
              Algumas pessoas bebem whisky.
              <br />
              Outras entendem o que ele representa.
            </h2>

            <div className="text emotional-text">
              <p>A diferença nunca foi o sabor.</p>
              <p>Sempre foi a percepção.</p>
            </div>
          </div>
        </motion.section>

        <motion.section className="section final-section" {...fadeUp}>
          <div className="container cta-shell">
            <div className="cta-copy">
              <p className="tag">ACESSO</p>

              <h2 className="section-title">
                Você já entendeu.
                <br />
                Agora decida se entra.
              </h2>

              <div className="text">
                <p>O acesso inicial acontece pelo Instagram.</p>
                <p>Contato direto. Sem excesso. Sem intermediários.</p>
                <p>Se você chegou até aqui, já está à frente da maioria.</p>
              </div>
            </div>

            <div className="cta-box">
              <span className="cta-label">LATENTE BRASA</span>
              <h3>Solicite acesso pelo Instagram</h3>

              <p>
                Entre no perfil oficial e acompanhe
                <br />
                os próximos movimentos da marca.
              </p>

              <button className="btn-primary full" onClick={openInstagram} type="button">
                Acessar agora
              </button>
            </div>
          </div>
        </motion.section>
      </main>

      <div className="mobile-cta">
        <div className="mobile-cta-copy">
          <span>LATENTE BRASA</span>
          <p>Acesso inicial via Instagram</p>
        </div>

        <button className="btn-primary mobile-cta-button" onClick={openInstagram} type="button">
          Acessar
        </button>
      </div>
    </div>
  );
}