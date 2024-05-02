import React from "react";
import {
  addListener,
  configureStore,
  createAsyncThunk,
  createListenerMiddleware,
  createSlice,
} from "@reduxjs/toolkit";
import { Provider, useDispatch, useSelector } from "react-redux";
import {
  ItemLocation,
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  VirtuosoMessageListMethods,
  VirtuosoMessageListProps,
} from "@virtuoso.dev/message-list";

interface Message {
  key: string;
  text: string;
  user: "me" | "other";
  replyTo?: string;
  highlighted?: boolean;
}

interface ChatSliceState {
  messages: Message[];
  loading: boolean;
  dataSetKey: number;
  initialLocation: ItemLocation;
  hasNewer: boolean;
}

const initialChatSliceState: ChatSliceState = {
  messages: [],
  loading: false,
  dataSetKey: Date.now(),
  initialLocation: { index: "LAST", align: "end" },
  hasNewer: false,
};

let idCounter = 0;

const entireChannel: Message[] = Array.from({ length: 1000 }, (_, index) => {
  const user = (["me", "other"] as const)[index % 2 ? 0 : 1];
  const message: Message = {
    user,
    text: `Message ${idCounter}`,
    key: `${idCounter++}`,
  };
  if (idCounter === 998) {
    message.replyTo = "985";
  }

  if (idCounter === 997) {
    message.replyTo = "560";
  }
  return message;
});

function fakeTimeout() {
  return new Promise((resolve) => setTimeout(resolve, 1000));
}

const loadInitialMessages = createAsyncThunk(
  "chat/loadInitialMessages",
  async () => {
    await fakeTimeout();
    const messages = entireChannel.slice(-20);
    return messages;
  },
);

const goToMessageWindow = createAsyncThunk(
  "chat/goToMessageWindow",
  async ({ key }: { key: string }, thunkApi) => {
    await fakeTimeout();

    const index = entireChannel.findIndex((message) => message.key === key);

    const messages = entireChannel.slice(
      Math.max(index - 10, 0),
      Math.min(index + 10, entireChannel.length),
    );
    thunkApi.dispatch(highlightMessage({ key }));
    return messages;
  },
);

const loadOlderMessages = createAsyncThunk(
  "chat/loadOlderMessages",
  async (_, thunkApi) => {
    await fakeTimeout();
    const state = thunkApi.getState() as ChatState;
    const firstMessage = state.chat.messages[0];
    const index = entireChannel.findIndex(
      (message) => message.key === firstMessage.key,
    );
    const messages = entireChannel.slice(index - 20, index);
    return messages;
  },
);

const loadNewerMessages = createAsyncThunk(
  "chat/loadNewerMessages",
  async (_, thunkApi) => {
    const state = thunkApi.getState() as ChatState;
    const lastMessage = state.chat.messages[state.chat.messages.length - 1];
    const index = entireChannel.findIndex(
      (message) => message.key === lastMessage.key,
    );
    if (index === entireChannel.length - 1) {
      return [];
    }

    await fakeTimeout();
    return entireChannel.slice(index + 1, index + 21);
  },
);

const scrollToMessage = createAsyncThunk(
  "chat/scrollToMessage",
  async ({ key }: { key: string }, thunkApi) => {
    const state = thunkApi.getState() as ChatState;
    const index = state.chat.messages.findIndex(
      (message) => message.key === key,
    );
    if (index > -1) {
      thunkApi.dispatch(highlightMessage({ key }));
    } else {
      thunkApi.dispatch(goToMessageWindow({ key }));
    }
    return { index, align: "center" };
  },
);

const highlightMessage = createAsyncThunk(
  "chat/highlightMessage",
  async ({ key }: { key: string }) => key,
);

const chatSlice = createSlice({
  name: "chat",
  initialState: initialChatSliceState,
  reducers: {
    loadInitial(state) {
      state.messages = entireChannel.slice(-20);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(loadInitialMessages.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(loadInitialMessages.fulfilled, (state, action) => {
      state.loading = false;
      state.dataSetKey = Date.now();
      state.messages = action.payload;
    });
    builder.addCase(loadOlderMessages.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(loadOlderMessages.fulfilled, (state, action) => {
      state.loading = false;
      state.messages = [...action.payload, ...state.messages];
    });
    builder.addCase(loadNewerMessages.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(loadNewerMessages.fulfilled, (state, action) => {
      state.loading = false;
      state.messages = [...state.messages, ...action.payload];
    });
    builder.addCase(goToMessageWindow.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(goToMessageWindow.fulfilled, (state, action) => {
      state.loading = false;
      state.messages = action.payload;
      const key = action.meta.arg.key;
      const index = state.messages.findIndex((message) => message.key === key);
      // reload the list, we're in a different window
      state.dataSetKey = Date.now();
      state.initialLocation = { index, align: "center" };
      state.hasNewer =
        state.messages[state.messages.length - 1].key !==
        entireChannel[entireChannel.length - 1].key;
    });
  },
});

const listenerMiddleware = createListenerMiddleware();
const chatStore = configureStore({
  reducer: {
    chat: chatSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(listenerMiddleware.middleware),
});

type ChatState = ReturnType<typeof chatStore.getState>;
export type ChatDispatch = typeof chatStore.dispatch;

const useChatDispatch = useDispatch.withTypes<ChatDispatch>();
const useAppSelector = useSelector.withTypes<ChatState>();

function App() {
  return (
    <Provider store={chatStore}>
      <Chat />
    </Provider>
  );
}

// Connect the virtuoso API to the chat store actions
function useConnectedVirtuosoRef() {
  const virtuoso = React.useRef<VirtuosoMessageListMethods<Message>>(null);
  const dispatch = useChatDispatch();
  const mounted = React.useRef(false);

  React.useEffect(() => {
    if (mounted.current) {
      return;
    }
    mounted.current = true;

    dispatch(
      addListener({
        actionCreator: loadOlderMessages.fulfilled,
        effect: (action) => {
          virtuoso.current?.data.prepend(action.payload);
        },
      }),
    );

    dispatch(
      addListener({
        actionCreator: loadNewerMessages.fulfilled,
        effect: (action) => {
          virtuoso.current?.data.append(action.payload);
        },
      }),
    );

    dispatch(
      addListener({
        actionCreator: highlightMessage.fulfilled,
        effect: (action) => {
          const index = virtuoso.current?.data.findIndex(
            (item) => item.key === action.payload,
          );

          virtuoso.current?.scrollToItem({ index: index!, align: "center" });
          setTimeout(() => {
            virtuoso.current?.data.map((message) => {
              if (message.key === action.payload) {
                return { ...message, highlighted: true };
              }
              return message;
            });
          }, 0);

          setTimeout(() => {
            virtuoso.current?.data.map((message) => {
              if (message.highlighted) {
                return { ...message, highlighted: false };
              }
              return message;
            });
          }, 800);
        },
      }),
    );
  }, [dispatch]);
  return virtuoso;
}

function Chat() {
  const mounted = React.useRef(false);
  const dispatch = useChatDispatch();
  const { loading, dataSetKey, messages, initialLocation, hasNewer } =
    useAppSelector((state) => state.chat);
  const virtuoso = useConnectedVirtuosoRef();

  React.useEffect(() => {
    if (mounted.current) {
      return;
    }
    mounted.current = true;
    dispatch(loadInitialMessages());
  }, [dispatch]);

  return (
    <div>
      <div>
        <VirtuosoMessageListLicense licenseKey="">
          <VirtuosoMessageList<Message, null>
            key={dataSetKey}
            initialData={messages}
            initialLocation={initialLocation}
            ref={virtuoso}
            style={{ height: 600 }}
            computeItemKey={({ data }) => data.key}
            ItemContent={ItemContent}
            onScroll={(location) => {
              if (!loading) {
                if (location.listOffset > -100) {
                  dispatch(loadOlderMessages());
                } else if (location.bottomOffset < 50 && hasNewer) {
                  dispatch(loadNewerMessages());
                }
              }
            }}
          />
        </VirtuosoMessageListLicense>
      </div>
      <div>{loading ? "Loading..." : "Loaded!"}</div>
    </div>
  );
}

const ItemContent: VirtuosoMessageListProps<Message, null>["ItemContent"] = ({
  data,
}) => {
  const dispatch = useChatDispatch();
  return (
    <div style={{ paddingBottom: "2rem", display: "flex" }}>
      <div
        style={{
          maxWidth: "50%",
          marginLeft: data.user === "me" ? "auto" : undefined,
          backgroundColor: data.highlighted
            ? "yellow"
            : data.user === "me"
              ? "lightblue"
              : "lightgreen",
          transition: data.highlighted ? undefined : "background-color 0.5s",
          borderRadius: "1rem",
          padding: "1rem",
        }}
      >
        {data.replyTo ? (
          <div
            style={{
              width: "80%",
              marginBottom: "1rem",
              backgroundColor: "white",
              borderRadius: "1rem",
              padding: "1rem",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
            onClick={() => {
              dispatch(scrollToMessage({ key: data.replyTo! }));
            }}
          >
            {data.replyTo} Message
          </div>
        ) : null}
        {data.text}
        <br />
      </div>
    </div>
  );
};

export default App;
