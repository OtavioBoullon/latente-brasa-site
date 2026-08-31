# Arquitetura — Poupai V1

Fluxo alvo:

`Fatura PDF/foto -> Ingestor -> Poupai Engine -> Catálogo de ofertas por CEP -> Diagnóstico grátis / Relatório completo`

## 1. Ingestor (próxima camada)
Responsável exclusivamente por transformar PDF/foto em texto ou JSON. Pode usar parser de PDF, OCR ou visão por IA. Nunca deve guardar chave de API no frontend.

## 2. Poupai Engine (implementado em index.js)
Regras determinísticas e auditáveis:
- parsing;
- validação;
- comparação;
- custo efetivo em 12 meses;
- filtro de oportunidade real;
- Poupai Score;
- montagem do diagnóstico e relatório.

## 3. Catálogo por CEP (próxima camada)
Coletores/adapters devem transformar ofertas reais no schema aceito pelo engine e registrar `sourceUrl` + `sourceCheckedAt`. Uma oferta sem evidência pode ser comparada em desenvolvimento, mas deve ter confiança menor e não deve ser apresentada como “confirmada”.

## 4. Frontend V4
Fica fora desta camada de lógica. Quando o engine + ingestor + catálogo estiverem estáveis, a V4 apenas envia a fatura/CEP e renderiza o JSON retornado.
