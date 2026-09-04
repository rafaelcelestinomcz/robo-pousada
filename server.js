import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import dotenv from 'dotenv';

// Ativa a leitura do arquivo de senhas (.env ou variáveis da Railway)
dotenv.config();

const app = express();
app.use(express.json());

// Liga o motor do Claude usando a sua chave secreta da Anthropic
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Lê o arquivo de texto em português com as regras da pousada
const systemPrompt = fs.readFileSync('./systemPrompt.txt', 'utf-8');

// Memória do robô: guarda o histórico recente das conversas por número de telefone
const conversas = {};

function gerenciarHistorico(whatsappId, novaMensagem, tipoUsuario) {
    const agora = Date.now();
    
    // 72 horas convertidas em milissegundos = 259.200.000
    const TEMPO_TRAVA_72H = 259200000;

    // Se o cliente já existia, mas a última mensagem dele foi há mais de 72 horas
    if (conversas[whatsappId] && (agora - conversas[whatsappId].ultimaInteracao > TEMPO_TRAVA_72H)) {
        // Apaga o histórico antigo para ele reiniciar e mandar a saudação de novo no próximo contato
        delete conversas[whatsappId];
    }

    if (!conversas[whatsappId]) {
        conversas[whatsappId] = {
            mensagens: [],
            ultimaInteracao: agora
        };
    }

    // Atualiza o horário da última mensagem enviada ou recebida
    conversas[whatsappId].ultimaInteracao = agora;

    conversas[whatsappId].mensagens.push({
        role: tipoUsuario, // 'user' para o cliente, 'assistant' para a robô Lucy
        content: novaMensagem
    });

    // Mantém apenas as últimas 15 mensagens para a conversa não ficar pesada demais
    if (conversas[whatsappId].mensagens.length > 15) {
        conversas[whatsappId].mensagens.shift();
    }

    return conversas[whatsappId].mensagens;
}

// O Webhook: a porta de entrada onde a Evolution API vai avisar que chegou mensagem
app.post('/webhook', async (req, res) => {
    try {
        const payload = req.body;
        
        // Se a mensagem foi enviada por você mesmo ou não for de texto, ignora
        if (!payload.data || !payload.data.message || payload.data.key.fromMe) {
            return res.sendStatus(200);
        }

        const whatsappId = payload.data.key.remoteJid;
        
        // Captura o texto que o cliente digitou no WhatsApp
        const textoCliente = payload.data.message.conversation || payload.data.message.extendedTextMessage?.text;

        if (!textoCliente) return res.sendStatus(200);

        // 1. Guarda o que o cliente digitou na memória da conversa e gerencia o tempo
        const historicoAtualizado = gerenciarHistorico(whatsappId, textoCliente, 'user');

        // 2. Envia o histórico + o manual da pousada para o Claude responder
        const msgClaude = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: systemPrompt,
            messages: historicoAtualizado,
        });

        const respostaBot = msgClaude.content.text;

        // 3. Guarda a resposta da Lucy na memória da conversa para ela lembrar depois
        gerenciarHistorico(whatsappId, respostaBot, 'assistant');

        // 4. Envia o texto da Lucy de volta para o WhatsApp do cliente
        await enviarMensagemWhatsapp(whatsappId, respostaBot);

        res.sendStatus(200);
    } catch (error) {
        console.error("Erro ao processar o atendimento:", error);
        res.sendStatus(500);
    }
});

// Função interna que dá a ordem para a Evolution API enviar a mensagem pro cliente
async function enviarMensagemWhatsapp(whatsappId, texto) {
    // Remove qualquer caractere extra do ID do WhatsApp para mandar pro número limpo
    const numeroLimpo = whatsappId.replace('@s.whatsapp.net', '');
    const url = `${process.env.WHATSAPP_API_URL}/message/sendText/${process.env.WHATSAPP_INSTANCE_TOKEN}`;
    
    const payload = {
        number: numeroLimpo,
        options: { 
            delay: 2500, // Espera 2.5 segundos para parecer humano
            presence: "composing" // Exibe "digitando..." no WhatsApp do cliente
        },
        text: texto
    };

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'apikey': process.env.AUTHENTICATION_API_KEY || ''
            },
            body: JSON.stringify(payload)
        });
       } catch (err) {
        console.error("Falha ao enviar mensagem de volta ao WhatsApp:", err);
    }
}

// Força o servidor a escutar na porta 8080 padrão da Railway
const PORT = 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🤖 Atendente virtual Marina online na porta ${PORT}`);
});
