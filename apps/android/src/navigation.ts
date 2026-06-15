// Route table shared by the navigator and the screens (typed params).

export type RootStackParamList = {
  Welcome: undefined;
  Home: undefined;
  Library: {libraryId: number; name?: string};
  Series: {seriesId: number};
  Player: {episodeId: number};
  Settings: undefined;
};
