#include <iostream>

int main() {
    double a = 0.0;
    double b = 0.0;

    std::cout << "Enter first number: ";
    if (!(std::cin >> a)) {
        std::cerr << "Invalid first number\n";
        return 1;
    }

    std::cout << "Enter second number: ";
    if (!(std::cin >> b)) {
        std::cerr << "Invalid second number\n";
        return 1;
    }

    std::cout << "Product: " << (a * b) << "\n";
    return 0;
}
