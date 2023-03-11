import { useEffect, useRef, useState } from 'react';
import { throttle } from 'lodash';

import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { v4 as uuid } from 'uuid';

import html2canvas from 'html2canvas';

import html2pdf from 'html2pdf-jspdf2';

import Link from 'next/link';

import '@fortawesome/fontawesome-free/css/all.min.css';

import styles from '@/styles/Home.module.scss';

import MessageItem from './components/MessageItem';
import AvatarUploader from './components/AvatarUploader';

import { chatWithGptTurbo } from '../open.ai.service';

import { Theme, SystemSettingMenu, ERole, IMessage } from '../interface';

import {
    dataURItoBlob,
    ThemeLocalKey,
    UserAvatarLocalKey,
    RobotAvatarLocalKey,
    SystemRoleLocalKey,
    APIKeyLocalKey,
} from '../utils';

const SystemMenus = [
    {
        label: 'Robot Avatar Settings',
        value: SystemSettingMenu.robotAvatarSettings,
    },
    {
        label: 'User Avatar Settings',
        value: SystemSettingMenu.userAvatarSettings,
    },
    {
        label: 'System Role Settings',
        value: SystemSettingMenu.systemRoleSettings,
    },
    {
        label: 'API KEY Settings',
        value: SystemSettingMenu.apiKeySettings,
    },
];

export default function Home() {
    const windowState = useRef({
        isMobile: false,
        windowHeight: 0,
        virtualKeyboardVisible: false,
    });

    useEffect(() => {
        const isMobile =
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                window.navigator.userAgent
            );
        windowState.current.isMobile = isMobile;
        windowState.current.windowHeight = window.innerHeight;
        const handleWindowResize = () => {
            windowState.current.virtualKeyboardVisible =
                window.innerHeight < windowState.current.windowHeight;
        };
        window.addEventListener('resize', handleWindowResize);
        return () => {
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

    const [theme, setTheme] = useState<Theme>('light');

    const [isGenerateFile, setIsGenerateFile] = useState(false);

    const [systemMenuVisible, setSystemMenuVisible] = useState(false);
    const [activeSystemMenu, setActiveSystemMenu] = useState<
        SystemSettingMenu | ''
    >('');

    const [apiKey, setApiKey] = useState('');
    const [apiKeyFromServer, SetApiKeyFromServer] = useState('');

    const handleGetApiKey = async () => {
        const response = await fetch('/api/get_available_api_key');
        const data = await response.json();
        SetApiKeyFromServer(data.apiKey);
        window.localStorage.setItem(APIKeyLocalKey, data.apiKey);
        setActiveSystemMenu('');
    };

    useEffect(() => {
        handleGetApiKey();
    }, []);

    const chatHistoryEle = useRef<HTMLDivElement | null>(null);

    const convertToPDF = () => {
        if (messageList.length === 0) {
            toast.warn('No question and answer content available', {
                autoClose: 1000,
            });
            return;
        }
        setIsGenerateFile(true);
        const element = chatHistoryEle.current;
        if (!element) return;

        const pdfPageWidth = element.clientWidth;

        const pdfPageHeight = element.scrollHeight;

        const opt = {
            margin: [0, 0, 0, 0],
            filename: `${new Date().getTime().toFixed(10)}myfile.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                width: pdfPageWidth,
                height: pdfPageHeight,
            },
            jsPDF: {
                unit: 'pt',
                format: 'a4',
                orientation: 'portrait',
            },
        };
        html2pdf().from(element).set(opt).save();
        setIsGenerateFile(false);
    };

    const convertToImage = () => {
        if (messageList.length === 0) {
            toast.warn('No question and answer content available', {
                autoClose: 1000,
            });
            return;
        }
        setIsGenerateFile(true);
        const messageEleList =
            document.querySelector('#chatHistory')?.childNodes;

        if (!messageEleList) return;
        if (!messageEleList.length) return;
        const promises: Promise<HTMLCanvasElement>[] = Array.from(
            messageEleList
        ).map((item) => {
            return html2canvas(item as HTMLElement);
        });
        // 将所有canvas拼接成一个大的canvas
        Promise.all(promises).then((canvases) => {
            let canvasWidth = 0,
                canvasHeight = 0;
            canvases.forEach((canvas) => {
                canvasWidth = Math.max(canvasWidth, canvas.width);
                canvasHeight += canvas.height;
            });
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = canvasWidth;
            finalCanvas.height = canvasHeight;

            const context = finalCanvas.getContext('2d');
            if (!context) return;

            let offsetY = 0;
            canvases.forEach((canvas) => {
                context.drawImage(canvas, 0, offsetY);
                offsetY += canvas.height - 2;
            });
            // 生成最终图片
            const imageData = finalCanvas.toDataURL('image/png');

            // 创建一个Blob对象

            const blob = dataURItoBlob(imageData);

            // 创建一个下载链接
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(blob);
            downloadLink.download = `${new Date()
                .getTime()
                .toFixed(10)}dialog_list.png`;

            // 模拟点击下载链接
            downloadLink.click();
            setIsGenerateFile(false);
        });
    };

    const [systemRole, setSystemRole] = useState<IMessage>({
        role: ERole.system,
        content: '',
        id: uuid(),
    });

    const [messageList, setMessageList] = useState<IMessage[]>([]);
    const [currentUserMessage, setCurrentUserMessage] = useState('');
    const userPromptRef = useRef<HTMLTextAreaElement | null>(null);
    // gpt-turbo的回复
    const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');

    const [loading, setLoading] = useState(false);

    const controller = useRef<AbortController | null>(null);

    const scrollSmoothThrottle = throttle(
        () => {
            if (!chatHistoryEle.current) return;
            chatHistoryEle.current.scrollTo({
                top: chatHistoryEle.current.scrollHeight,
                behavior: 'smooth',
            });
        },
        300,
        {
            leading: true,
            trailing: false,
        }
    );

    const [serviceErrorMessage, setServiceErrorMessage] = useState('');

    const chatGPTTurboWithLatestUserPrompt = async (isRegenerate = false) => {
        // 先把用户输入信息展示到对话列表
        if (!isRegenerate && !currentUserMessage) return;

        const newMessageList = messageList.concat([]);
        if (!isRegenerate) {
            newMessageList.push({
                role: ERole.user,
                content: currentUserMessage,
                id: uuid(),
            });
        }

        // 取出最近的3条messages，作为上下文
        const len = newMessageList.length;
        const latestMessageLimit3 = newMessageList.filter(
            (_, idx) => idx >= len - 4
        );
        if (!latestMessageLimit3.some((item) => item.role === ERole.system)) {
            // system role setting
            latestMessageLimit3.unshift(
                systemRole.content
                    ? systemRole
                    : {
                          role: ERole.system,
                          content:
                              'You are a versatile expert, please answer each of my questions in a simple and easy-to-understand way as much as possible',
                          id: systemRole.id,
                      }
            );
        }

        setMessageList(newMessageList);
        setCurrentUserMessage('');
        if (!userPromptRef.current) return;
        userPromptRef.current.style.height = 'auto';
        scrollSmoothThrottle();

        try {
            setServiceErrorMessage('');
            setLoading(true);
            controller.current = new AbortController();

            const response = await chatWithGptTurbo(
                apiKey || apiKeyFromServer,
                latestMessageLimit3,
                controller.current
            );

            if (!response.ok) {
                throw new Error(response.statusText);
            }
            const data = response.body;

            if (!data) {
                throw new Error('No Data');
            }
            const reader = data.getReader();
            const decoder = new TextDecoder('utf-8');
            let newCurrentAssistantMessage = '';
            // 循环读取数据
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                // 处理读取到的数据块
                if (value) {
                    let char = decoder.decode(value);
                    if (
                        char === `\n` &&
                        newCurrentAssistantMessage.endsWith(`\n`)
                    ) {
                        continue;
                    }
                    if (char) {
                        newCurrentAssistantMessage += char;
                        setCurrentAssistantMessage(newCurrentAssistantMessage);
                    }
                    scrollSmoothThrottle();
                }
            }
            setLoading(false);
            archiveCurrentMessage(newCurrentAssistantMessage);
        } catch (error: any) {
            setLoading(false);
            controller.current = null;
            setServiceErrorMessage(error?.error?.message || 'Service Error');
        }
    };

    const archiveCurrentMessage = (newCurrentAssistantMessage: string) => {
        if (newCurrentAssistantMessage) {
            setMessageList((list) =>
                list.concat([
                    {
                        role: ERole.assistant,
                        content: newCurrentAssistantMessage,
                        id: uuid(),
                    },
                ])
            );
            setLoading(false);
            controller.current = null;
            setCurrentUserMessage('');
            setCurrentAssistantMessage('');
        }
    };

    // 头像
    const [robotAvatar, setRobotAvatar] = useState<string>('/robot.png');

    const updateRobotAvatar = (img: string) => {
        setRobotAvatar(img);
        setActiveSystemMenu('');
        window.localStorage.setItem(RobotAvatarLocalKey, img);
    };

    const [userAvatar, setUserAvatar] = useState<string>('/fox.png');

    const updateUserAvatar = (img: string) => {
        setUserAvatar(img);
        setActiveSystemMenu('');
        window.localStorage.setItem(UserAvatarLocalKey, img);
    };

    useEffect(() => {
        const light_gpt_theme =
            window.localStorage.getItem(ThemeLocalKey) || 'light';
        setTheme(light_gpt_theme as Theme);
        const light_gpt_user_avatar =
            window.localStorage.getItem(UserAvatarLocalKey) || '/fox.png';
        setUserAvatar(light_gpt_user_avatar);
        const light_gpt_robot_avatar =
            window.localStorage.getItem(RobotAvatarLocalKey) || '/robot.png';
        setRobotAvatar(light_gpt_robot_avatar);
        const light_gpt_system_role =
            window.localStorage.getItem(SystemRoleLocalKey) || '';
        if (light_gpt_system_role !== '') {
            setSystemRole({
                role: ERole.system,
                content: light_gpt_system_role,
                id: uuid(),
            });
        }
        const light_gpt_api_key =
            window.localStorage.getItem(APIKeyLocalKey) || '';
        if (light_gpt_api_key !== '') {
            setApiKey(light_gpt_api_key);
        }
    }, []);

    return (
        <div id="app" className={styles.app} data-theme={theme}>
            <ToastContainer></ToastContainer>
            <div
                className={`${styles.systemSettingMenus} ${
                    systemMenuVisible && styles.show
                }`}
            >
                {SystemMenus.map((menu) => (
                    <div
                        key={menu.value}
                        className={styles.menu}
                        onClick={() => {
                            setActiveSystemMenu(menu.value);
                        }}
                    >
                        {menu.label}
                    </div>
                ))}
            </div>
            <div className={styles.header}>
                <div className={styles.title}>
                    <span className={styles.item}>Light</span>
                    <span className={styles.item}>GPT</span>
                </div>
                <div className={styles.description}>
                    Based on OpenAI API(gpt-3.5-turbo)
                </div>
                <div className={styles.menus}>
                    <div
                        className="themeToggleBtn"
                        onClick={() => {
                            setTheme(theme === 'light' ? 'dark' : 'light');
                            window.localStorage.setItem(
                                ThemeLocalKey,
                                theme === 'light' ? 'dark' : 'light'
                            );
                        }}
                    >
                        {theme === 'light' ? (
                            <i className="fas fa-moon"></i>
                        ) : (
                            <i className="fas fa-sun"></i>
                        )}
                    </div>
                    <i
                        className="fas fa-cog"
                        onClick={() => {
                            setSystemMenuVisible((visible) => !visible);
                        }}
                    ></i>

                    <i
                        className="fab fa-github"
                        onClick={() => {
                            window.open(
                                'https://github.com/riwigefi/light-gpt',
                                '_blank'
                            );
                        }}
                    ></i>
                </div>
            </div>
            <div className={styles.main}>
                <div
                    id="chatHistory"
                    className={styles.chatHistory}
                    ref={(e) => (chatHistoryEle.current = e)}
                >
                    {messageList
                        .filter((item) => item.role !== ERole.system)
                        .map((item) => (
                            <MessageItem
                                key={item.id}
                                id={item.id}
                                role={item.role}
                                avatar={
                                    item.role === ERole.user
                                        ? userAvatar
                                        : robotAvatar
                                }
                                message={item.content}
                            />
                        ))}
                    {loading && currentAssistantMessage.length > 0 && (
                        <MessageItem
                            id={uuid()}
                            role={ERole.assistant}
                            avatar={robotAvatar}
                            message={currentAssistantMessage}
                        />
                    )}
                    <div className={styles.placeholder}>
                        <div className={styles.child}></div>
                    </div>
                </div>
            </div>
            <div className={styles.footer}>
                {serviceErrorMessage !== '' && (
                    <div className={styles.openAiServiceError}>
                        {serviceErrorMessage}
                    </div>
                )}

                <div className={styles.action}></div>
                <div className={styles.middle}>
                    <div className={styles.textareaContainer}>
                        {/** mobile regenerate and stop action */}
                        <div className={styles.mobileAction}>
                            {loading ? (
                                <div
                                    className={styles.btn}
                                    onClick={() => {
                                        if (controller.current) {
                                            controller.current.abort();
                                            setLoading(false);
                                            archiveCurrentMessage(
                                                currentAssistantMessage
                                            );
                                        }
                                    }}
                                >
                                    Stop
                                </div>
                            ) : (
                                <div
                                    className={styles.btn}
                                    onClick={() =>
                                        chatGPTTurboWithLatestUserPrompt(true)
                                    }
                                >
                                    Regenerate
                                </div>
                            )}
                        </div>
                        <textarea
                            className={styles.userPrompt}
                            onChange={(e) => {
                                setCurrentUserMessage(e.target.value);
                            }}
                            onInput={() => {
                                if (
                                    userPromptRef.current &&
                                    userPromptRef.current.scrollHeight > 50
                                ) {
                                    userPromptRef.current.style.height =
                                        userPromptRef.current.scrollHeight +
                                        2 +
                                        'px';
                                }
                            }}
                            value={currentUserMessage}
                            ref={(e) => {
                                userPromptRef.current = e;
                            }}
                            placeholder={
                                loading
                                    ? 'gpt is thinking...'
                                    : 'ask gpt for anything...'
                            }
                            rows={1}
                            onKeyDown={(event) => {
                                if (
                                    (event.code === 'Enter' ||
                                        event.code === 'Done') &&
                                    !windowState.current.isMobile
                                ) {
                                    event.preventDefault();
                                    chatGPTTurboWithLatestUserPrompt(false);
                                }
                                // event.key 的值不受操作系统和键盘布局的影响，它始终表示按下的是哪个字符键。
                                if (
                                    (event.key === 'Enter' ||
                                        event.key === 'Done') &&
                                    windowState.current.isMobile
                                ) {
                                    (
                                        document.activeElement as HTMLElement
                                    ).blur();
                                }
                            }}
                            onBlur={() => {
                                if (windowState.current.isMobile) {
                                    chatGPTTurboWithLatestUserPrompt(false);
                                }
                            }}
                        />
                        <div className={styles.submit}>
                            {loading ? (
                                <div className={styles.spinner}></div>
                            ) : (
                                <i
                                    className="fas fa-paper-plane"
                                    style={{ transform: 'scale(1.2)' }}
                                    onClick={() =>
                                        chatGPTTurboWithLatestUserPrompt(false)
                                    }
                                ></i>
                            )}
                        </div>
                    </div>
                    <div className={styles.siteDescription}>
                        <span>Made by wjm</span>
                        <span>｜</span>
                        <span>Just have fun</span>
                    </div>
                </div>
                <div className={styles.action}>
                    {loading ? (
                        <div
                            className={styles.btn}
                            onClick={() => {
                                if (controller.current) {
                                    controller.current.abort();
                                    setLoading(false);
                                    archiveCurrentMessage(
                                        currentAssistantMessage
                                    );
                                }
                            }}
                        >
                            Stop
                        </div>
                    ) : (
                        <div
                            className={styles.btn}
                            onClick={() =>
                                chatGPTTurboWithLatestUserPrompt(true)
                            }
                        >
                            Regenerate
                        </div>
                    )}
                </div>
            </div>
            <div
                className={`${styles.extraFunction} ${
                    !messageList.length && styles.noMessage
                }`}
            >
                <i className="fas fa-image" onClick={convertToImage}></i>
                <i className="fas fa-file-pdf" onClick={convertToPDF}></i>
                <i
                    className="fas fa-trash-alt"
                    onClick={() => {
                        if (messageList.length === 0) {
                            toast.warn(
                                'No question and answer content available',
                                { autoClose: 1000 }
                            );
                            return;
                        }
                        setMessageList([]);
                    }}
                ></i>
            </div>

            {/** 模态框 */}
            <div
                className={`${styles.modal} ${
                    !activeSystemMenu && styles.hide
                }`}
            >
                <div className={styles.modalContent}>
                    <i
                        className={`fas fa-times ${styles.closeIcon}`}
                        onClick={() => {
                            setActiveSystemMenu('');
                        }}
                    ></i>
                    {activeSystemMenu ===
                        SystemSettingMenu.robotAvatarSettings && (
                        <AvatarUploader
                            title="Robot Avatar Settings"
                            img={robotAvatar}
                            updateAvatar={updateRobotAvatar}
                        />
                    )}
                    {activeSystemMenu ===
                        SystemSettingMenu.userAvatarSettings && (
                        <AvatarUploader
                            title="User Avatar Settings"
                            img={userAvatar}
                            updateAvatar={updateUserAvatar}
                        />
                    )}
                    {activeSystemMenu ===
                        SystemSettingMenu.systemRoleSettings && (
                        <div className={styles.systemRoleSettings}>
                            <label htmlFor="systemRole">System Role</label>
                            <textarea
                                placeholder="Enter system role here"
                                id="systemRole"
                                value={systemRole.content}
                                cols={20}
                                rows={4}
                                onChange={(e) => {
                                    setSystemRole({
                                        role: ERole.system,
                                        content: e.target.value,
                                        id: uuid(),
                                    });
                                    window.localStorage.setItem(
                                        ThemeLocalKey,
                                        e.target.value
                                    );
                                }}
                            ></textarea>

                            <div className={styles.description}>
                                System role refers to the role identity in the
                                generated text, which can be different
                                characters, robots, or other entities. By
                                setting different system roles, you can control
                                the emotions and tone of the generated text to
                                better adapt to the needs of specific scenarios.
                            </div>

                            <div className={styles.benefits}>
                                Do not know how to define system role? Come{' '}
                                <Link
                                    href="https://github.com/f/awesome-chatgpt-prompts"
                                    target="_blank"
                                >
                                    Awesome ChatGPT Prompts
                                </Link>{' '}
                                to choose the system role you want
                            </div>
                            <div className={styles.btnContainer}>
                                <button
                                    className={styles.saveButton}
                                    onClick={() => {
                                        setActiveSystemMenu('');
                                    }}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    )}
                    {activeSystemMenu === SystemSettingMenu.apiKeySettings && (
                        <div className={styles.systemRoleSettings}>
                            <label htmlFor="apiKey">Open AI API Key</label>
                            <input
                                placeholder="Enter your open ai api key"
                                id="apiKey"
                                value={apiKey}
                                onChange={(e) => {
                                    setApiKey(e.target.value);
                                    window.localStorage.setItem(
                                        APIKeyLocalKey,
                                        e.target.value
                                    );
                                }}
                            ></input>

                            <div className={styles.description}>
                                Please enter your API key, which will ensure
                                that your assistant runs faster and better.
                                <strong>
                                    Rest assured that the API key you enter will
                                    not be uploaded to our server, but will only
                                    be stored locally in your browser, with no
                                    risk of leakage. We will do our utmost to
                                    protect your privacy and data security.
                                </strong>
                            </div>

                            <div className={styles.benefits}>
                                Do not know how to get your api key?If you have
                                a chatGPT account, please visit{' '}
                                <Link
                                    href="https://platform.openai.com/account/api-keys"
                                    target="_blank"
                                >
                                    Open AI Platform API keys
                                </Link>{' '}
                                to to view your API key list.If you do not have
                                a chatGPT account, please click the button below
                                to get a temporary API key, which may have slow
                                access speed. Therefore, to ensure faster
                                conversation, please use your own API key as
                                much as possible.
                            </div>
                            <div className={styles.btnContainer}>
                                <button
                                    className={styles.saveButton}
                                    onClick={() => {
                                        setActiveSystemMenu('');
                                    }}
                                >
                                    Save
                                </button>
                                <button
                                    className={styles.saveButton}
                                    onClick={() => {
                                        handleGetApiKey();
                                        setApiKey('');
                                    }}
                                >
                                    Get API Key
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/** 生成图片、pdf的简单loading */}
            {isGenerateFile && (
                <div className={styles.loading}>
                    <div className={styles.loadingSpinner}></div>
                </div>
            )}
        </div>
    );
}
