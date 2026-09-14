// Practice 4 — Two Motors
// FORWARD and BACKWARD are filled in from your confirmed Step 2 logic.
// LEFT, RIGHT and STOP are left for you to finish — fill in the TODOs
// with the pin values you decide in your worksheet before uploading.

const int ENA = 5;   // PWM speed, motor A (change to your actual wiring)
const int IN1 = 6;
const int IN2 = 7;
const int ENB = 10;  // PWM speed, motor B (change to your actual wiring)
const int IN3 = 8;
const int IN4 = 9;

void setup() {
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
}

void loop() {
  // Call moveForward(), moveBackward(), turnLeft(), turnRight() or stopMotors()
  // here once LEFT/RIGHT/STOP are filled in.
}

void moveForward() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, 255);
  analogWrite(ENB, 255);
}

void moveBackward() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  analogWrite(ENA, 255);
  analogWrite(ENB, 255);
}

void turnLeft() {
  // TODO: fill in IN1-IN4 for "motor A atrás, motor B adelante" (or al revés,
  // según cómo tengas cableados los motores) — confirma primero en tu worksheet.
}

void turnRight() {
  // TODO: lo opuesto de turnLeft().
}

void stopMotors() {
  // TODO: decide coast (ENA=0, ENB=0) vs brake (ENA=255, ENB=255, IN1==IN2, IN3==IN4)
  // y escribe los digitalWrite/analogWrite correspondientes aquí.
}
