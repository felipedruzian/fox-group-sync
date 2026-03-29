# Workspace Group Sync (Personal)

MVP de extensão para Firefox Desktop que:

- lê os **grupos de abas nativos** da janela atual;
- salva um snapshot do grupo (nome, cor, estado colapsado e URLs);
- sincroniza esses snapshots usando **`browser.storage.sync`**;
- restaura o snapshot em outro Firefox desktop logado na mesma **conta Mozilla**.

## Escopo deste MVP

Compatível com **Firefox Desktop (Windows/Linux)**.

Este pacote foi preparado para o caso de uso pedido: sincronizar grupos entre instalações desktop do Firefox.

## Requisitos

- Firefox **141+**
- mesma conta Mozilla conectada nos dispositivos
- em `Configurações > Sincronização`, a opção **Add-ons** deve estar habilitada

## Limitações importantes

- O Firefox **não sincroniza grupos nativos** por conta própria; a sincronização aqui é feita pela extensão, via `storage.sync`.
- O `groupId` do Firefox **não é estável** entre reinícios/restaurações; por isso a extensão salva um snapshot lógico (nome/cor/URLs), não o ID nativo.
- Este MVP foi desenhado para desktop. Não depende de backend externo.
- URLs internas/restritas podem não ser restauráveis. Neste caso elas são ignoradas.
- `storage.sync` tem limite de tamanho. Muitos workspaces grandes podem estourar a cota.

## Estrutura

- `manifest.json`
- `background.js`
- `popup.html`
- `popup.js`
- `popup.css`
- `icons/icon.svg`

## Como testar durante o desenvolvimento

1. Abra `about:debugging#/runtime/this-firefox`
2. Clique em **Load Temporary Add-on**
3. Selecione qualquer arquivo dentro desta pasta (por exemplo, `manifest.json`)
4. A extensão ficará carregada até reiniciar o Firefox

## Como instalar de forma permanente

Para Firefox release/beta, o add-on precisa ser **assinado pela Mozilla**.

Fluxo recomendado:

1. compacte esta pasta em `.zip` ou `.xpi`
2. envie para assinatura **unlisted/self-distributed** no AMO
3. instale o `.xpi` assinado em cada Firefox

## Melhorias que podem vir depois

- renomear snapshots
- sobrescrever snapshot existente
- restaurar em nova janela
- exportar/importar JSON manualmente
- portar para Chromium
