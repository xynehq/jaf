// Mock for canvas to avoid Jest import issues

export const createCanvas = jest.fn().mockImplementation(() => ({
  width: 100,
  height: 100,
  getContext: jest.fn().mockReturnValue({
    drawImage: jest.fn(),
    putImageData: jest.fn(),
  }),
  toBuffer: jest.fn().mockReturnValue(Buffer.from('mock-image-data')),
}));

export const Image = jest.fn().mockImplementation(() => ({
  onload: null,
  onerror: null,
  src: null,
  width: 100,
  height: 100,
}));

export const ImageData = jest.fn().mockImplementation((data: any, width: number, height: number) => ({
  data,
  width,
  height,
}));

export default {
  createCanvas,
  Image,
  ImageData,
};